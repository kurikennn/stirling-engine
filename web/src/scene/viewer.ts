// three.js scene: loads the GLB, applies link poses, section plane, exploded view,
// thermal colouring and picking. Everything kinematic is computed elsewhere; this
// module only turns planar poses into node matrices.

import {
  ACESFilmicToneMapping,
  ClippingGroup,
  Color,
  DirectionalLight,
  DoubleSide,
  FrontSide,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Plane,
  Raycaster,
  Scene,
  ShadowNodeMaterial,
  Vector2,
  Vector3,
  WebGPURenderer,
  type MeshStandardMaterial,
} from "three/webgpu";
import { frontFacing, select, uniform } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import type { LinkName, Pose2 } from "../kinematics/linkage";
import type { PartInfo, PartsDoc } from "../ui/types";

export interface MechanismGeometry {
  plane: { origin: [number, number, number]; u: [number, number, number]; v: [number, number, number] };
  cylinders: Record<"hot" | "cold", { point: [number, number]; dir: [number, number]; z: number }>;
  links: Record<string, LinkName>;
}

interface PartNode {
  mesh: Mesh;
  name: string;
  part: PartInfo;
  link: LinkName;
  host?: string;
  base: Matrix4;
  explode: Vector3; // CAD frame, metres, at explode = 1
  material: MeshStandardNodeMaterial;
  baseColor: Color;
  colorU: ColorUniform;
  hoverU: ColorUniform;
  glass: boolean;
}

const colorUniform = (c: Color) => uniform(c, "color");
type ColorUniform = ReturnType<typeof colorUniform>;

const CAP_COLOR = new Color("#ff5a36");
const HOT_TINT = new Color("#ff6a2b");
const COLD_TINT = new Color("#2b8cff");
const HOVER = new Color("#3a7bd5").multiplyScalar(0.55);
const SELECT = new Color("#ffb020").multiplyScalar(0.6);

export class Viewer {
  readonly renderer: WebGPURenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  backendName = "";

  private clipGroup = new ClippingGroup();
  private engineRoot: Object3D | null = null;
  private parts: PartNode[] = [];
  private byName = new Map<string, PartNode>();
  private mech!: MechanismGeometry;
  private sectionPlane = new Plane();
  private sectionBase = { point: new Vector3(), normal: new Vector3() };
  private sectionOn = false;
  private sectionFlip = false;
  private sectionOffset = 0;
  private explode = 0;
  private hovered: PartNode | null = null;
  private selected: PartNode | null = null;
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private viewTouched = false;
  private initialView = { position: new Vector3(), target: new Vector3() };

  onPick: (info: { part: PartInfo; node: string; link: LinkName } | null) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new WebGPURenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new PerspectiveCamera(35, 1, 0.005, 20);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 2;
    this.controls.addEventListener("start", () => (this.viewTouched = true));

    this.scene.add(this.clipGroup);
    this.clipGroup.clippingPlanes = [];
    new ResizeObserver(() => this.resize()).observe(container);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean };
    this.backendName = backend.isWebGPUBackend ? "WebGPU" : "WebGL2 (fallback)";

    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.9;
    this.scene.background = new Color(getComputedStyle(document.documentElement).getPropertyValue("--scene-bg").trim() || "#1b1e23");

    this.scene.add(new HemisphereLight(0xffffff, 0x444444, 0.4));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.25, 0.5, 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -0.25;
    sun.shadow.camera.right = 0.25;
    sun.shadow.camera.top = 0.25;
    sun.shadow.camera.bottom = -0.25;
    sun.shadow.camera.near = 0.05;
    sun.shadow.camera.far = 1.5;
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 4;
    this.scene.add(sun);

    const ground = new Mesh(new PlaneGeometry(2, 2), new ShadowNodeMaterial({ opacity: 0.35 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.0002;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const dom = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    dom.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
    dom.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) this.pick(e, true);
      down = null;
    });
    dom.addEventListener("pointermove", (e) => {
      if (e.pointerType === "mouse" && e.buttons === 0) this.pick(e, false);
    });
    dom.addEventListener("pointerleave", () => this.setHover(null));
  }

  async load(url: string, partsDoc: PartsDoc, mech: MechanismGeometry, onProgress: (f: number) => void): Promise<void> {
    this.mech = mech;
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    });
    const root = gltf.scene.getObjectByName("engine");
    if (!root) throw new Error("engine.glb has no 'engine' root node");
    this.engineRoot = root;
    this.clipGroup.add(gltf.scene);

    const partsById = new Map(partsDoc.parts.map((p) => [p.id, p]));
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const extras = mesh.userData as { part?: string; link?: LinkName; host?: string };
      const part = partsById.get(extras.part ?? "");
      if (!part) throw new Error(`node ${mesh.name}: unknown part '${extras.part}'`);
      const name = mesh.name;
      const link = mech.links[name] ?? extras.link ?? "ground";
      const src = mesh.material as MeshStandardMaterial;
      const def = partsDoc.materials[part.material_class];
      const glass = def.opacity !== undefined;

      const baseColor = new Color(def.color);
      const colorU = colorUniform(baseColor.clone());
      const hoverU = colorUniform(new Color(0, 0, 0));
      const mat = new MeshStandardNodeMaterial({
        metalness: def.metalness,
        roughness: def.roughness,
        transparent: glass,
        opacity: def.opacity ?? 1,
        depthWrite: !glass,
        side: glass ? DoubleSide : FrontSide,
      });
      // Back faces are only visible through the section cut: paint them as the cut face.
      mat.colorNode = glass ? colorU : select(frontFacing, colorU, uniform(CAP_COLOR));
      mat.emissiveNode = glass ? hoverU : select(frontFacing, hoverU, uniform(CAP_COLOR.clone().multiplyScalar(0.35)));
      src.dispose?.();
      mesh.material = mat;
      mesh.castShadow = !glass;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();

      const node: PartNode = {
        mesh,
        name,
        part,
        link,
        host: extras.host,
        base: mesh.matrix.clone(),
        explode: new Vector3(...(part.explode_mm ?? [0, 0, 0])).multiplyScalar(1e-3),
        material: mat,
        baseColor,
        colorU,
        hoverU,
        glass,
      };
      this.parts.push(node);
      this.byName.set(name, node);
    });
    // Hardware inherits the exploded-view offset of its host part.
    for (const p of this.parts) {
      if (p.host && this.byName.has(p.host) && !p.part.explode_mm) p.explode.copy(this.byName.get(p.host)!.explode);
    }

    this.frameCamera();
    this.setupSection();
    this.resize();
  }

  /** The plane through both cylinder axes, in world space. */
  private setupSection(): void {
    this.engineRoot!.updateWorldMatrix(true, false);
    const m = this.engineRoot!.matrixWorld;
    const { hot, cold } = this.mech.cylinders;
    const pl = this.mech.plane;
    const cad = (p: [number, number], z: number) => {
      const o = new Vector3(...pl.origin);
      const u = new Vector3(...pl.u);
      const v = new Vector3(...pl.v);
      return o.addScaledVector(u, p[0]).addScaledVector(v, p[1]).setZ(z).multiplyScalar(1e-3);
    };
    const a = cad(hot.point, hot.z).applyMatrix4(m);
    const b = cad(cold.point, cold.z).applyMatrix4(m);
    const dirCad = new Vector3(...pl.u).multiplyScalar(hot.dir[0]).addScaledVector(new Vector3(...pl.v), hot.dir[1]);
    const dir = dirCad.transformDirection(m);
    const normal = new Vector3().subVectors(b, a).cross(dir).normalize();
    // Keep the half away from the default camera, so the cut faces the viewer.
    if (normal.dot(new Vector3().subVectors(this.initialView.position, a)) > 0) normal.negate();
    this.sectionBase = { point: a, normal };
    this.updateSection();
  }

  private updateSection(): void {
    const n = this.sectionBase.normal.clone().multiplyScalar(this.sectionFlip ? -1 : 1);
    const p = this.sectionBase.point.clone().addScaledVector(this.sectionBase.normal, this.sectionOffset);
    this.sectionPlane.setFromNormalAndCoplanarPoint(n, p);
    this.clipGroup.clippingPlanes = this.sectionOn ? [this.sectionPlane] : [];
    for (const p of this.parts) {
      const side = p.glass || this.sectionOn ? DoubleSide : FrontSide;
      if (p.material.side !== side) {
        p.material.side = side;
        p.material.needsUpdate = true;
      }
    }
  }

  setSection(on: boolean, offsetMm = this.sectionOffset * 1e3, flip = this.sectionFlip): void {
    this.sectionOn = on;
    this.sectionOffset = offsetMm * 1e-3;
    this.sectionFlip = flip;
    this.updateSection();
  }

  setExplode(k: number): void {
    this.explode = k;
  }

  setThermal(on: boolean): void {
    for (const p of this.parts) {
      const c = p.baseColor.clone();
      if (on && p.part.thermal === "hot") c.lerp(HOT_TINT, 0.6);
      if (on && p.part.thermal === "cold") c.lerp(COLD_TINT, 0.6);
      p.colorU.value.copy(c);
    }
  }

  /** Apply planar link poses (mm, plane coordinates) to every node. */
  applyPoses(poses: Record<LinkName, Pose2>): void {
    const pl = this.mech.plane;
    const o = new Vector3(...pl.origin).multiplyScalar(1e-3);
    const u = new Vector3(...pl.u);
    const v = new Vector3(...pl.v);
    const n = new Vector3().crossVectors(u, v);
    const basis = new Matrix4().makeBasis(u, v, n);
    const basisInv = basis.clone().transpose();
    const toPlane = new Matrix4().makeTranslation(-o.x, -o.y, -o.z).premultiply(basisInv);
    const fromPlane = basis.clone().setPosition(o);

    const linkMatrix = new Map<LinkName, Matrix4>();
    for (const [link, pose] of Object.entries(poses) as [LinkName, Pose2][]) {
      const m2 = new Matrix4().makeRotationZ(pose.angle).setPosition(pose.tx * 1e-3, pose.ty * 1e-3, 0);
      linkMatrix.set(link, fromPlane.clone().multiply(m2).multiply(toPlane));
    }
    const e = new Matrix4();
    for (const p of this.parts) {
      const lm = linkMatrix.get(p.link) ?? new Matrix4();
      e.makeTranslation(p.explode.x * this.explode, p.explode.y * this.explode, p.explode.z * this.explode);
      p.mesh.matrix.copy(e).multiply(lm).multiply(p.base);
      p.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  private frameCamera(): void {
    const target = new Vector3(0, 0.07, 0);
    this.initialView.target.copy(target);
    this.initialView.position.set(-0.34, 0.2, 0.32);
    this.resetView();
  }

  resetView(): void {
    // Portrait screens need more distance to fit the engine's width.
    const k = this.camera.aspect < 0.9 ? 1.7 : 1;
    this.camera.position.copy(this.initialView.position).sub(this.initialView.target).multiplyScalar(k).add(this.initialView.target);
    this.controls.target.copy(this.initialView.target);
    this.controls.update();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole engine in view on narrow (portrait) screens.
    this.camera.fov = w / h < 0.9 ? 50 : 35;
    this.camera.updateProjectionMatrix();
    if (!this.viewTouched) this.resetView();
  }

  private pick(e: PointerEvent, click: boolean): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.parts.map((p) => p.mesh),
      false,
    );
    const hit = hits.find((h) => !this.sectionOn || this.sectionPlane.distanceToPoint(h.point) >= 0);
    const node = hit ? this.byName.get(hit.object.name) ?? null : null;
    if (click) {
      this.setSelected(node);
      this.onPick(node ? { part: node.part, node: node.name, link: node.link } : null);
    } else this.setHover(node);
  }

  private setHover(n: PartNode | null): void {
    if (this.hovered === n) return;
    const prev = this.hovered;
    this.hovered = n;
    this.refreshHighlight(prev);
    this.refreshHighlight(n);
    this.renderer.domElement.style.cursor = n ? "pointer" : "";
  }

  setSelected(n: PartNode | null | string): void {
    const node = typeof n === "string" ? this.byName.get(n) ?? null : n;
    const prev = this.selected;
    this.selected = node;
    this.refreshHighlight(prev);
    this.refreshHighlight(node);
  }

  private refreshHighlight(n: PartNode | null): void {
    if (!n) return;
    // Highlight every instance of the same part, so e.g. all five short shafts light up.
    for (const p of this.parts) {
      if (p.part.id !== n.part.id) continue;
      const isSel = this.selected?.part.id === p.part.id;
      const isHov = this.hovered?.part.id === p.part.id;
      p.hoverU.value.copy(isSel ? SELECT : isHov ? HOVER : new Color(0, 0, 0));
    }
  }

  render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
