# Bill of materials

Transcribed from the parts list on the assembly drawing [`drawings/pdf/00_assembly.pdf`](../drawings/pdf/00_assembly.pdf).
This table is the single source of truth for the part data used by the web demo: `tools/convert/bom_to_parts.py` turns it into `web/public/parts.json`.

Column notes:

- **Id**: the English part id. It is the node name in `web/public/engine.glb`.
- **Process**: `machined` means made in-house from raw stock (工程 キ on the drawing). `purchased` means a bought-in part (工程 ソ).
- **Mass**: in kg, as on the drawing (0.00 = below 5 g).
- **Operations**: the machining operations. `TODO` means the author has not filled it in yet.

| No | Id | Name | 品名 | Material | Qty | Process | Mass | Drawing | Operations |
|---|---|---|---|---|---|---|---|---|---|
| 01 | 01_base | Base | ベース | A2017P | 1 | machined | 0.29 | 01_base.pdf | TODO |
| 02 | 02_side_plate | Side plate | 横板 | A2017P | 1 | machined | 0.41 | 02_side_plate.pdf | TODO |
| 03 | 03_flywheel | Flywheel | フライホイール | Brass | 1 | machined | 0.44 | 03_flywheel.pdf | TODO |
| 04 | 04_crank_arm | Crank arm | クランクアーム | A2017P | 1 | machined | 0.02 | 04_crank_arm.pdf | TODO |
| 05 | 05_heating_cap_jacket | Heating cap jacket | 加熱キャップジャケット | A2017 | 1 | machined | 0.06 | 05_heating_cat_jacket.pdf | TODO |
| 06 | 06_hot_cylinder_jacket | Hot cylinder jacket | 高温部シリンダジャケット | A2017P | 1 | machined | 0.08 | 06_hot_cylinder_jacket.pdf | TODO |
| 07 | 07_heating_cap | Heating cap | 加熱キャップ | SUS304-B | 1 | machined | 0.04 | 07_heating_cap.pdf | TODO |
| 08 | 08_hot_piston_adapter | Hot piston adapter | 高温部ピストンアダプタ | A2017P | 1 | machined | 0.01 | 08_hot_piston_adapter.pdf | TODO |
| 09 | 09_cold_cylinder | Cold cylinder | 低温部シリンダ | A2017P | 1 | machined | 0.06 | 09_cold_cylinder.pdf | TODO |
| 10 | 10_cold_piston | Cold piston | 低温部ピストン | A2017P | 1 | machined | 0.04 | 10_cold_piston.pdf | TODO |
| 11 | 11_center_shaft_base_connector | Centre shaft to base connector | 中心軸-ベース接続部品 | A2017P | 1 | machined | 0.06 | 11_center_shaft_base_connector.pdf | TODO |
| 12 | 12_t_crank_guide_rod_base_connector | T-crank guide rod to base connector | T字クランク拘束ロッド-ベース接続部品 | A2017P | 1 | machined | 0.01 | 12_t_crank_guide_rod_base_connector.pdf | TODO |
| 13 | 13_t_crank | T-crank (Ross yoke) | T字クランク | A2017P | 1 | machined | 0.03 | 13_t_crank.pdf | TODO |
| 14 | 14_t_crank_guide_rod | T-crank guide rod | T字クランク拘束ロッド | A2017P | 1 | machined | 0.01 | 14_t_crank_guide_rod.pdf | TODO |
| 15 | 15_piston_drive_rod | Piston drive rod | ピストン駆動ロッド | A2017P | 2 | machined | 0.01 | 15_piston_drive_rod.pdf | TODO |
| 16 | 16_short_shaft | Short shaft | 短シャフト | SUS304 | 5 | machined | 0.00 | 16_17_18_shafts.pdf | TODO |
| 17 | 17_long_shaft | Long shaft | 長シャフト | SUS304 | 2 | machined | 0.00 | 16_17_18_shafts.pdf | TODO |
| 18 | 18_center_shaft | Centre shaft | 中心軸シャフト | SUS304 | 1 | machined | 0.01 | 16_17_18_shafts.pdf | TODO |
| 19 | 19_spacer | Spacer | スペーサ | Brass | 3 | machined | 0.00 | 19_20_21_spacers.pdf | TODO |
| 20 | 20_center_spacer | Centre shaft spacer | 中心軸スペーサ | Brass | 2 | machined | 0.00 | 19_20_21_spacers.pdf | TODO |
| 21 | 21_spacer_t_crank_side | T-crank side spacer | T字クランク側スペーサ | Brass | 2 | machined | 0.00 | 19_20_21_spacers.pdf | TODO |
| 22 | 22_hot_seal | Hot side rubber seal | 高温部ゴムパッキン | Silicone rubber | 2 | machined | 0.00 | 22_hot_seal.pdf | TODO |
| 23 | 23_cold_seal | Cold side rubber seal | 低温部ゴムパッキン | Silicone rubber | 1 | machined | 0.00 | 23_cold_seal.pdf | TODO |
| 24 | 24_water_cooling_plate_mechanism_side | Water-cooling plate, mechanism side | 機構側水冷用板 | A2017P | 1 | machined | 0.04 | 24_water_cooling_plate_mechanism_side.pdf | TODO |
| 25 | 25_water_cooling_plate_wheel_side | Water-cooling plate, wheel side | ホイール側水冷用板 | A2017P | 1 | machined | 0.04 | 25_water_cooling_plate_wheel_side.pdf | TODO |
| 26 | 26_water_cooling_plate_side_plate_side | Water-cooling plate, side-plate side | 横板側水冷用板 | A2017P | 1 | machined | 0.05 | 26_water_cooling_plate_side_plate_side.pdf | TODO |
| 27 | 27_hot_cylinder | Hot cylinder | 高温部シリンダ | Glass | 1 | purchased | 0.01 | 27_hot_cylinder.pdf | — |
| 28 | 28_hot_piston | Hot piston | 高温部ピストン | Glass | 1 | purchased | 0.02 | 28_hot_piston.pdf | — |
| 29 | 29_bearing_mf84zz | Flanged ball bearing MF84ZZ | ベアリング MF84ZZ | Steel | 14 | purchased | — | — | — |
| 30 | 30_bearing_mf106zz | Flanged ball bearing MF106ZZ | ベアリング MF106ZZ | Steel | 2 | purchased | — | — | — |
| 31 | 31_shim_ring | Shim ring | シムリング | SUS304-B | 11 | purchased | 0.00 | — | — |
| 32 | 32_stopper | Stopper (shaft collar) | ストッパ | SS400 | 7 | purchased | 0.00 | — | — |
| 33 | 33_bolt_m6x25 | Socket head cap screw M6x25 | 六角穴付きボルト M6x25 | Steel | 1 | purchased | 0.00 | — | — |
| 34 | 34_bolt_m6x20 | Socket head cap screw M6x20 | 六角穴付きボルト M6x20 | Steel | 1 | purchased | 0.00 | — | — |
| 35 | 35_bolt_m5x25 | Socket head cap screw M5x25 | 六角穴付きボルト M5x25 | Steel | 4 | purchased | 0.00 | — | — |
| 36 | 36_bolt_m5x20 | Socket head cap screw M5x20 | 六角穴付きボルト M5x20 | Steel | 4 | purchased | 0.00 | — | — |
| 37 | 37_bolt_m5x16 | Socket head cap screw M5x16 | 六角穴付きボルト M5x16 | Steel | 2 | purchased | 0.00 | — | — |
| 38 | 38_bolt_m3x25 | Socket head cap screw M3x25 | 六角穴付きボルト M3x25 | Steel | 4 | purchased | 0.00 | — | — |
| 39 | 39_bolt_m3x20 | Socket head cap screw M3x20 | 六角穴付きボルト M3x20 | Steel | 4 | purchased | 0.00 | — | — |
| 40 | 40_bolt_m3x16 | Socket head cap screw M3x16 | 六角穴付きボルト M3x16 | Steel | 4 | purchased | 0.00 | — | — |
| 41 | 41_bolt_m3x10 | Socket head cap screw M3x10 | 六角穴付きボルト M3x10 | Steel | 4 | purchased | 0.00 | — | — |
| 42 | 42_set_screw_m4x8 | Set screw, flat point, M4x8 | 六角穴付き止めねじ 平先 M4x8 | Steel | 1 | purchased | 0.00 | — | — |
| 43 | 43_set_screw_m3x12 | Set screw, flat point, M3x12 | 六角穴付き止めねじ 平先 M3x12 | Steel | 1 | purchased | 0.00 | — | — |
| 44 | 44_set_screw_m3x6 | Set screw, flat point, M3x6 | 六角穴付き止めねじ 平先 M3x6 | Steel | 1 | purchased | 0.00 | — | — |
| 45 | 45_set_screw_m3x5 | Set screw, flat point, M3x5 | 六角穴付き止めねじ 平先 M3x5 | Steel | 6 | purchased | 0.00 | — | — |
