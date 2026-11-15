# 寵物基底與尺寸研究

2026-11-14。入口：`demos/photo-cat/index.html`（照片工作室）與 `demos/photo-cat/base-catalog.html`（原始基底與共同尺寸對照）。

## 實作界線

照片工作室採用下載的獨立基底，重新繪製色盤／花紋。沒有把使用者整張照片當模型貼圖。可動來源保留既有骨架、權重與動畫；靜態來源不宣稱可動。新增的貴賓、吉娃娃、臘腸目前只適配色盤與全高，局部輪廓控制、照片臉部花紋停用。暹羅來源經降面，不能宣稱維持原始拓樸。

基底頁展示下載來源或明確標示的衍生基底，支援同一公尺尺度的兩模型比對。相機拉近不改模型尺寸。其他動物目前是已下載、檢查過的基底候選，不代表照片轉其他動物功能完成。

## 尺寸契約

- GLB 座標單位為公尺。UI 公分輸入除以 100 後縮放模型。
- 全高是模型基準姿勢的完整垂直外框，包含頭、耳朵及抬起的尾巴；不是肩高。
- 其他動物若採最大外框，包含尾巴及其他伸出部位，不是鼻到尾根長。
- 每個預設都是可編輯展示估計，並非從單張照片推算，亦不等於品種標準。
- 來源軸向與骨架基準姿勢需先校準。捕捉完成適配後的 rest pose；匯出只調整複本，播放到不同幀不應改變縮放比。
- `physicalSize` extras 記錄 cm、meter、axis、measurementKind、pose、estimated。需要精確寵物大小時，以實際個體尺寸覆寫。品種肩高來源另存 `docs/pet-size-references.json`，不直接套進全高。

## Lightapaw 其他動物抽樣

在 [Lightapaw memorials](https://lightapaw.com/memorials) 選 Other，讀取三批、共 144 張紀念卡，檢視其中 80 多張可取得的照片。這是抽樣，不是全站普查；人像、明顯錯分的貓狗、空白圖與不清楚圖片不算確認物種。參考照片僅作本機檢查，未放進網站資產或訓練集。

| 照片例子 | 觀察 | 基底處理 |
|---|---|---|
| [樣本 1](https://lightapaw.com/%D1%82%D1%8E%D0%BF%D0%B0) | 垂耳兔 | 目前直耳兔不能冒充垂耳兔，仍需垂耳基底 |
| [樣本 10](https://lightapaw.com/lola-51) | 天竺鼠 | 獨立天竺鼠，不能用倉鼠代替 |
| [樣本 11](https://lightapaw.com/margarida) | 母雞 | 已改用有正常頭頸、身體與腳的母雞 |
| [樣本 13](https://lightapaw.com/b%C4%B1c%C4%B1r%C4%B1k) | 虎皮鸚鵡 | 獨立鳥基底，但原作比例很卡通 |
| [樣本 14](https://lightapaw.com/%D0%BC%D0%B0%D0%BB%D1%8B%D1%88-11) | 雪貂 | 長身短腿獨立基底 |
| [樣本 33](https://lightapaw.com/pryanik-2) | 倉鼠 | 基底較粗略，仍待改善 |
| [樣本 53](https://lightapaw.com/erizabeth) | 刺蝟 | 獨立基底；刺部簡化 |
| [樣本 58](https://lightapaw.com/sinto-falta-do-meu-peixinho-di) | 金魚 | 獨立金魚且保留游泳動畫 |
| [樣本 62](https://lightapaw.com/pino-3) | 馬 | 獨立馬基底及動畫 |
| [樣本 137](https://lightapaw.com/gary-4) | 陸棲龜類，精確種類待確認 | 尚無適合基底，不能套水龜 |
| [樣本 142](https://lightapaw.com/%D0%BC%D0%B5%D1%80%D0%BB%D0%B8%D0%BD) | 紅耳龜型 | 候選含木頭，尚待清理，停用尺寸匯出 |
| [樣本 143](https://lightapaw.com/%E9%9B%B7%E5%A4%A2-2) | 和尚鸚鵡型 | 通用鸚鵡不能等同此物種，尚待專屬基底 |

另確認大鼠、玄鳳鸚鵡等樣本。玄鳳與紅耳龜候選的發布者標示 AI 製作，均靜態，已在目錄註明。紅耳龜模型附木頭，整體外框不是龜長，因此禁止以寵物尺寸匯出。

## 目前基底目錄

| 類別 | 基底 | 三角面 | 原動畫 | 適配狀態 | 來源 |
|---|---|---:|---:|---|---|
| 貓 | 一般短毛／確認版跑步貓 | 1,550 | 1 | 照片工作室 | [Daily Lowpoly](https://sketchfab.com/3d-models/lowpoly-cat-rig-run-animation-c36df576c9ae4ed28e89069b1a2f427a) · CC BY 4.0 |
| 貓 | 圓臉厚身貓 | 1,856 | 1 | 照片工作室 | [J-Toastie](https://poly.pizza/m/DJ9rpAhrh3) · CC BY 3.0 |
| 貓 | 波斯貓／長毛扁臉 | 7,646 | 0 | 照片工作室 | [HOLOGRAMO](https://www.printables.com/model/1363957-persian-cat-princess-donut-low-poly-dungeon-crawle/files) · CC BY 4.0 |
| 狗 | 柴犬 | 1,950 | 12 | 照片工作室 | [Quaternius](https://quaternius.com/packs/ultimateanimatedanimals.html) · CC0 |
| 狗 | 哈士奇 | 1,920 | 12 | 照片工作室 | [Quaternius](https://quaternius.com/packs/ultimateanimatedanimals.html) · CC0 |
| 狗 | 德國牧羊犬（來源含配件） | 4,898 | 22 | 照片工作室 | [Quaternius](https://poly.pizza/m/Hssa6NPc6W) · CC0 / 保留來源署名 |
| 狗 | 巴哥／哈巴狗 | 644 | 2 | 照片工作室 | [Quaternius](https://poly.pizza/m/1gXKv15ik8) · CC0 |
| 狗 | 博美 | 500 | 0 | 照片工作室 | [MarceloAMS / Marcelo Silva](https://www.printables.com/model/36149-pomeranian-low-poly/files) · CC0 |
| 其他動物 | 馬 | 2,182 | 26 | 基底候選 | [Quaternius](https://poly.pizza/m/qvTrSG9pZF) · CC0-1.0 |
| 其他動物 | 鸚鵡 | 651 | 0 | 基底候選 | [Poly by Google](https://poly.pizza/m/dfNjMLtO0pd) · CC-BY-3.0 |
| 其他動物 | 雪貂 | 794 | 0 | 基底候選 | [Poly by Google](https://poly.pizza/m/4I1SBFHWuSo) · CC-BY-3.0 |
| 其他動物 | 母雞 | 592 | 0 | 基底候選 | [Poly by Google](https://poly.pizza/m/8Unya0rw9tR) · CC-BY-3.0 |
| 其他動物 | 天竺鼠 | 416 | 0 | 基底候選 | [packer](https://sketchfab.com/3d-models/guinea-pig-cc4990e30b994b85b57b9d5e56f0e8e6) · CC-BY-4.0 |
| 其他動物 | 大鼠 | 4,004 | 6 | 基底候選 | [Quaternius](https://poly.pizza/m/iltq5bVNaV) · CC0 |
| 其他動物 | 直耳兔 | 954 | 0 | 基底候選 | [Poly by Google](https://poly.pizza/m/3vvONbRCuEF) · CC BY 3.0 |
| 其他動物 | 刺蝟（粗略基底） | 376 | 0 | 基底候選 | [Poly by Google](https://poly.pizza/m/8UNni5IvK_c) · CC BY 3.0 |
| 其他動物 | 倉鼠（粗略基底） | 488 | 0 | 基底候選 | [Poly by Google](https://poly.pizza/m/3YtzEQ5TVUP) · CC BY 3.0 |
| 其他動物 | 虎皮鸚鵡（卡通型） | 830 | 4 | 基底候選 | [Gobkit](https://gobkit.com/freebies) · CC0-1.0 |
| 其他動物 | 金魚 | 1,590 | 6 | 基底候選 | [Quaternius](https://quaternius.com/packs/cutefish.html) · CC0-1.0 |
| 其他動物 | 玄鳳鸚鵡（AI 靜態候選） | 6,464 | 0 | 基底候選 | [3DAssets.dev](https://3dassets.dev/assets/pets-and-companions-hd-cockatiel-f4a552b1) · CC0-1.0 |
| 其他動物 | 紅耳龜含木頭（待清理） | 2,976 | 0 | 基底候選 | [3DAssets.dev](https://3dassets.dev/assets/reptiles-amphibians-and-minibeasts-red-eared-slider-on-b9a994a9) · CC0-1.0 |
| 狗 | 貴賓 | 852 | 0 | 照片工作室 | [Poly by Google](https://poly.pizza/m/eQmBaLcGbbE) · CC-BY-3.0 |
| 狗 | 吉娃娃（卡通型） | 484 | 4 | 照片工作室 | [Gobkit](https://gobkit.com/freebies) · CC0-1.0 |
| 狗 | 臘腸犬 | 6,374 | 7 | 照片工作室 | [spooneystone](https://sketchfab.com/3d-models/dashshund-dog-cb0abb276cc247f095c0c527db987276) · CC-BY-4.0 |
| 貓 | 暹羅／纖長大耳（靜態） | 3,999 | 0 | 照片工作室 | [Fig Fogg](https://sketchfab.com/3d-models/cute-siamese-cat-d6a186ef07a24abc8e0e97b924941cc8) · CC BY 4.0 |
| 狗 | 黃金獵犬（靜態坐姿） | 444 | 0 | 照片工作室 | [Agustin Arroyo / Flowalistik](https://www.printables.com/model/276-low-poly-golden-retriever-beto/files) · CC-BY-SA-4.0 |
| 貓 | 斯芬克斯／無毛貓（靜態） | 4,818 | 0 | 照片工作室 | [jakeblakeley](https://sketchfab.com/3d-models/sphynx-cat-sculpt-8dd24cd03aa0404bb5f043da29cdef79) · CC BY 4.0 |

## 已知限制與驗證

- 德牧原始基底帶配件；照片適配版本移除背包，仍有原網格融合的領巾／腰帶輪廓。
- J-Toastie 圓臉基底是體型選項，不憑外觀冒稱特定純種。
- 波斯貓與暹羅皆靜態。暹羅原始 37,888 三角面，衍生 3,999 面，原本已有分離細節且非水密，不能當成原 runner 完整連通拓樸的同等替代。
- 用 Lucas 實測圓臉貓配色與 32 cm 匯出。用 Alfie 測波斯基底匯出流程；Alfie 不是已確認波斯貓，此例不宣稱品種或身份相似。
- 既有實際下載 GLB 已檢查幾何、骨架／動畫、共享位置接縫及重新繪製色盤。尺寸測試覆蓋公分到公尺、不同動畫幀、預覽不變與錯誤量測種類拒絕。
- 未執行身份辨識或提供虛假的相似百分比；背面與被遮住的花色仍是估計。

- 新增斯芬克斯原雕塑降至 4,818 三角面；無毛、抬腳站姿，無骨架。不同於暹羅／波斯／一般短毛的實際獨立基底。
- 黃金獵犬是原作者 Beto 的 444 三角面靜態坐姿。採 Printables 的 CC BY-SA 4.0 授權；衍生 GLB 保留此授權及署名，不能重新標為 CC0。
- 最終共有 5 個貓基底、9 個狗基底、13 個其他動物候選。不是每一個都具有連續水密網格；保留骨架者也依各來源的原始拓樸處理。


## 黑白貓細節修正

- 黑白雙色、低彩度且沒有明顯有色毛斑時，校正黑白材質的紫灰偏色；橘色與虎斑配色保留。
- 自動臉高估計收斂至 0.92–1.08，避免把照片鼻子投影距離誤當整顆頭的三維長度。
- J-Toastie 臉部投影改用排除耳朵的臉寬與額頭範圍，改善白鼻梁、眼鼻位置與下巴色塊。
- 新增白斑覆蓋、頸部長度，以及臉部近看視角。頸部以連續座標變形縮短，仍使用原骨架與動畫。
- 使用者要求每個多邊面單一顏色。更新後的照片適配模型會以衍生三角網格承載五官分色，去除面內頂點漸層和臉部貼圖；來源目錄仍列原始 1,856 面基底，衍生面數以工作室實際統計為準。

## 2026-11-15 跑步貓換頭

**目前專案正式基底：** `public/models/cat/runner-ear-controls.blend`，對應網站資產 `public/models/cat/runner-base.glb`（1,550 三角面、53 骨骼、1.5 秒跑步）。捏臉頁、照片產生器和公園共用此版。使用 `npm run models:cat-base` 從 Blender 發布並驗證；`runner-base.json` 記錄來源與輸出雜湊。以下保留前期製作過程，`runner-approved-head.glb` 為中間版本。

跑步貓改用 `cat/runner-approved-head.glb`（1,550 三角面）。身體來源仍為 Daily Lowpoly；有色原頭 `cat-head-approved.glb` 保留，另存去色版 `cat-head-uncolored.glb` 並使用去色版接到身體。去色版移除 COLOR_0 與 unlit 彩繪材質，保留眼睛幾何及四個 morph targets，頭、頸和身體共用毛色。移除舊頭的 158 面，頸部由下半部斜向開口接到胸口，中間頸圈經 Blender 固定邊界鬆弛，耳朵和上半部頭型保留。來源頭 GLB／Blend 檔未改動。

「細緻站姿貓」及其 GLB 已移除；舊設定會回退到跑步貓。重建指令：`python3 scripts/attach-approved-cat-head.py`。

2026-11-15 使用者確認：以完成臉頰微幅蒙皮變形、尾根下方輪廓與權重修正的版本作為後續貓模型基礎。當時資產為 `public/models/cat/runner-approved-head.glb`；對應 Blender 檔為 `public/models/cat/runner-run-skin-refined.blend`。完整重建順序見 `demos/README.md`，最後一步為 `npm run models:cat-run-skin`。其他四個貓型仍是獨立來源基底，尚未轉製成此確認版的衍生品種。

後續動作編輯使用 `public/models/cat/runner-editable-rig.blend`：整理耳朵、四腳掌及尾巴的骨骼位置與長度，保留 35 個骨骼節點，並補償骨骼靜止座標變更以維持跑步的蒙皮變形。舊 Blender 檔保留作比較；此為後續 53 骨骼基底的中間版本。

四肢連接版本為 `public/models/cat/runner-connected-rig.blend`：在上述版本補上左右肩、髖，以及四肢內部的關節連接，共 51 骨骼。新增連接骨是實際父子骨鏈的一部分；跑步中兩端持續接合，並以動畫座標補償維持原有模型變形。重建與驗證：`npm run models:cat-connected-rig`、`npm run check:cat-connected-rig`。

目前動作編輯最新版為 `public/models/cat/runner-ear-controls.blend`（53 骨骼）：左右耳各有頭部連接骨、耳根及耳身。選取 `Cat Rig`，在 Object Properties → Custom Properties 調整 `ear_spread_L/R`（外展）、`ear_tilt_L/R`（正值朝前、負值朝後）、`ear_fold_L/R`（耳身折彎），單位為度，可插入關鍵影格。全部設為 0 保持原跑步耳形。檔內文字 `EAR CONTROLS - READ ME` 附飛機耳／朝前／朝後參數；耳朵權重已局部化，不再拉扯臉部。241 個跑步樣本最大表面差異約 0.00019 毫米；140 個中立／跑步／耳朵表情姿勢通過骨骼中心線包含檢查。重建與驗證：`npm run models:cat-ear-controls`、`npm run check:cat-ear-controls`。已透過 `npm run models:cat-base` 發布為專案正式 GLB；六個耳朵驅動控制保留於 Blender，GLB 目前包含中立耳形的跑步與完整耳骨。

2026-11-15 側面接合修正：取消後側小接合口，改為下半部斜向開口，移除懸垂底座，經收窄的中間頸圈直接連到胸口。獨立有色與去色頭均保留。

頸長修正：Blender 將整個頭與雙眼向身體移近 0.032、下降 0.004（來源 bind-space 單位），降低上肩輪廓，喉部往內收，形成下巴到胸口的轉折。動畫、權重與獨立頭檔保留，逐幀接縫檢查最大間隙 0。

側面參考比例修正：以使用者第二張自然站姿圖為主，頭部適度放大、下肢與腹部間距拉開、收順胸腹腰線、腳掌稍加寬，尾巴改細並加上弧度。第一張衛教圖只參考部位關係，不模仿體態流失。維持 1,550 面、35 骨骼和原跑步動畫。

後頸連續性修正：退回原本伸到後腦前方的上肩接合邊界，後腦下緣向肩背收成斜向輪廓；合併表面跨接縫鬆弛，保留 low poly 面法線。臀部上緣體積與後腿根部局部權重也一併收順。
