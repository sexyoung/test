# Photo → low-poly cat：實作與驗證紀錄

## 使用方式

執行 `npm run dev`，開啟 `/demos/photo-cat/index.html`。選擇 JPG、PNG 或 WebP，確認照片左側眼睛、右側眼睛、鼻尖三個定位點，再調整毛色與比例。一般模式在瀏覽器中執行，不需要 API 金鑰或生成費。照片不會送到外部服務。

`下載 GLB` 匯出目前顯示的模型；`下載分析紀錄` 匯出照片分析、手動設定與已知限制。`對照原模型` 將原 794 面跑步貓與生成結果並排，方便看靜態輪廓、面片密度與播放動作時的關節。

## 參考照片觀察

2026-11-14 在 [Light a Paw memorials](https://lightapaw.com/memorials) 選擇 Cats，查看初始清單並按兩次 Show more，共三批、144 個卡片。觀察到橘虎斑、灰虎斑、黑白、三花、玳瑁、重點色、長毛、短毛及無毛外觀。並非每張照片都能辨認品種，因此程式不把花色當成品種分類。

實際試樣：[Lucas](https://lightapaw.com/lucas-10)、[Alfie](https://lightapaw.com/alfie-14)、[рыжуля](https://lightapaw.com/%D1%80%D1%8B%D0%B6%D1%83%D0%BB%D1%8F-3)。少量照片僅暫存本機作測試，不納入公開網站素材、不訓練模型。

重要外觀差異包含：額頭白斑的寬度與左右不對稱、鼻色、瞳色、臉寬、耳朵及毛量。全身、側臉、趴睡、遮擋、兩隻貓同框的照片都會降低自動定位可靠度。

## 實作路徑

### 瀏覽器照片微調既有 GLB（主要流程）

以現有 `public/models/lowpoly_cat_rig__run_animation.glb` 作初始模型，保留 794 個三角面、35 根骨骼與 1.5 秒跑步動畫；不重新建立貓的拓撲。照片只驅動外觀與局部形狀微調，對重合頂點使用相同變形以維持接合。

像素分析以色彩分群與空間分布取得候選毛色、眼鼻位置及花紋；這是啟發式分析，不是訓練過的貓臉辨識器。可用三點校正修正。臉部取樣按雙眼方向對齊，將身體花色保留成頂點顏色，並根據照片的主要色塊分布重新繪製低色數臉部花紋、眼睛與鼻子；不把原始照片貼到模型上；看不到的背面用可編輯花紋近似。

此路徑不聲稱完整三維重建或身份辨識。沒有自動「像不像」百分比。分析信心是啟發式測量資訊，不是經校準的成功機率；照片光線仍會影響取色，單張照片無法可靠推算身體深度。

### Apple Silicon 本機 AI 研究（未納入主要介面）

[Hunyuan3D-Swift](https://github.com/ZimengXiong/Hunyuan3D-Swift) 提供 [Python MLX shape implementation](https://github.com/ZimengXiong/Hunyuan3D-Swift/tree/main/python/shape)，可用 Apple GPU 執行真正的 image-conditioned geometry inference。這個環境沒有 Xcode Metal compiler，使用 Python MLX wheel 避開 Swift 原生編譯需求。

小型模型：[hunyuan3d-mlx-shape-small](https://huggingface.co/zimengxiong/hunyuan3d-mlx-shape-small)。程式碼 MIT，不代表權重 MIT；權重沿用 [Tencent Hunyuan3D-2 Community License](https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE)。研究後端記載 Powered by Tencent Hunyuan；正式對外服務前須按實際服務地區與使用方式確認模型條款。

AI 產生的是靜態幾何，尚未自動綁定貓的骨架。照片顏色投射也不是完整材質重建。實測外觀與減面拓撲不合格，因此未放入主要介面，也未把靜態結果當作已通過動畫驗收。

安裝與啟動見 `server/photo-cat-mlx/README.md`。大模型快取保存在使用者 Library/Caches，不進 Git。主要照片介面不呼叫 AI 後端；研究 CLI 與 loopback API 必須另外執行。靜態網站不包含這個實驗後端。

## 其他方法比較

| 方法 | 對本機優先的影響 |
| --- | --- |
| [TripoSR](https://github.com/VAST-AI-Research/TripoSR) | MIT；官方預設 CUDA，約 6 GB VRAM；[run.py](https://github.com/VAST-AI-Research/TripoSR/blob/main/run.py) 在沒有 CUDA 時轉 CPU，不能當作現成 Apple GPU 路徑。 |
| [Stable Fast 3D](https://github.com/Stability-AI/stable-fast-3d) | 官方 MPS 實驗性；低於 32 GB RAM 建議 CPU；權重需 Hugging Face 授權存取，適合作另一路研究，不作免設定預設。 |
| [Hunyuan3D-2.1](https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1) | 官方完整 shape+texture 流程約 29 GB VRAM，這台 24 GB Mac 不採完整材質流程。 |
| 既有 GLB 照片微調 | 即時、免生成費、可修正且保留已驗證的骨架與拓撲；單張照片看不到的形狀仍需人工決定。 |

## 驗證方式與目前限制

先啟動開發伺服器，再執行 `npm run check:photo-cat -- --url http://localhost:5176`（改成實際連接埠）。測試需本機 Chrome，可用 `CHROME_PATH` 指定路徑。此命令驗證合成照片的已知取色、花紋與不確定性處理，以及幾何有限數值、GLB 匯出後重新載入。技術檢查通過不代表外觀相似。

實照比對觀察：

- Lucas：自動眼睛候選大致接近，但鼻子和瞳色仍可能錯誤；人工三點後取得黑色主毛、白色次毛、粉色鼻。修正了原本只選到灰白色群的問題。
- Alfie：全身照自動定位會錯把胸前／項圈區域當臉；人工三點後辨為棕虎斑。毛量需要手動調整。
- 橘貓：傾斜照片自動定位會誤判額頭斑紋；人工三點後辨為虎斑。已加入眼線旋轉對齊，但陰影會使毛色與眼色偏暗。

不能宣稱這三張照片全自動達到個體級相似度。這一版的可用流程是「照片分析 → 校正定位 → 手動比對輪廓／花色 → 檢查動作 → 匯出」。

原始 GLB 基準：794 三角面、1 個 SkinnedMesh、35 根骨骼、39 條動畫 tracks。以 1e-5 位置焊接容差檢查，原始網格已有少量邊界／非流形邊，因此不將「完全 watertight」當作對它的描述；重點是新版本不新增斷裂，同位置頂點在播放時保持相接。

本機 AI 實測：M4 Pro 執行 30 steps 約 25.7 秒，mesh 解碼約 9.2 秒；推論可執行，但測試照片輸出不像貓，quadric 減面引入非流形邊。驗證器拒絕匯出不合格的 GLB，故主要版本採既有骨架貓微調。詳見後端 README。

## 最終版本的著色原則

照片只提供配色、白斑／虎斑位置及比例參考。臉部重新繪製為有限色盤的花紋與幾何五官，不能直接使用照片 RGB 作表面貼圖。內嵌 PNG 若存在，也必須是重新繪製的低色數圖，不含原照片影像。原始模型的索引、蒙皮與動畫維持不變。

## 貓狗八張實照展示（2026-11-14）

加入 Quaternius CC0 的 Shiba Inu 與 Husky 原始骨架基底；授權與來源見 public/models/dog/LICENSE.txt。狗照片從 Light a Paw 的 Dogs 篩選三批展示卡片中，以固定亂數順序挑選五張可辨識五官的照片，詳見 photo-dog-reference-notes.md。這不是未經挑選的成功率測試。

三隻貓為 Lucas、橘貓、Alfie；五隻狗為 Ttotto、Zelda、Miss、Snoet、Yeontan。所有範例均人工標記雙眼及鼻尖；橘貓改為虎斑、Alfie 增加輪廓蓬鬆度。五隻狗另人工校正四個配色與口鼻、耳朵、頭寬或身形；Snoet 使用 Husky，其他使用 Shiba。展示截圖是實際介面及實際匯出的 GLB，並非渲染概念圖。

外觀比對：黑白貓的色塊較易辨識；橘貓陰影造成偏暗，Alfie 的長毛輪廓未還原。狗的毛色可以近似，但五隻仍明顯帶有基底的長腿與身形；短吻犬、長毛犬、長垂耳犬及博美不能視為個體重建成功。耳朵使用原始耳骨權重與共用位置變形，避免材質分區或動畫接點分離。技術驗證與相似度分開評估，不提供虛構相似度分數。

目前適合可手動編輯的初稿；若要達到紀念寵物的個體辨識，仍需要更多品種骨架基底、腿長／軀幹比例與長毛輪廓控制，以及更可靠的臉部定位和花紋分割。

## 耳型與頭型修正

新增耳長、耳寬、耳根間距、頭顱前後深度、臉頰寬度、口鼻寬度六項獨立控制，避免所有照片只改整體臉寬或耳朵等比例大小。這些控制目前必須人工依照片比對，未宣稱已自動辨識耳型或品種。眼鼻三點不能可靠推知耳根、耳尖或頭顱深度。

Lucas 的測試加寬臉頰並縮短耳長；Zelda 的測試加寬臉頰與口鼻、縮短頭顱深度並加寬直立耳。長垂耳測試另做視覺檢查：即使接縫測試通過，也可能出現細長折片，不能單憑拓撲／動畫檢查宣稱外觀合格。圓耳尖和長毛輪廓仍受原始基底拓撲限制。
