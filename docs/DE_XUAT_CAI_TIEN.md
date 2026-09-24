# BÁO CÁO NGHIÊN CỨU, ĐÁNH GIÁ VÀ ĐỀ XUẤT CẢI TIẾN
## Hệ thống mô phỏng – tối ưu tín hiệu giao thông mạng lưới (quy mô 500 nút)

Tài liệu này ghi lại kết quả rà soát dự án *Digital Twin điều khiển tín hiệu TP.HCM* (bản MVP1 "Green Zone Player"
cùng 3 tài liệu: `README.md`, `SYSTEM_SPECIFICATION_AND_ROADMAP.md`, `TRAFFIC_ALGORITHMS_AND_DATA_SPECIFICATION.md`),
các điểm cần hiệu chỉnh, và các phương pháp đã được hiện thực trong phần mềm **TSO – Tối ưu Tín hiệu Mạng lưới**
của kho mã này.

---

## 1. Đánh giá chung bản MVP1 và bộ tài liệu

**Điểm mạnh.**
- Định hướng đúng: hỗ trợ người vận hành ra quyết định thay vì chỉ hiển thị.
- Tổ chức theo khung giờ (sáng, giữa ngày, chiều, đêm) và theo các lớp: vùng → hành lang → nút.
- Đã có ý tưởng chấm điểm khả thi sóng xanh (GWS), phân vùng theo ma trận tương quan và so sánh A/B.
- Có dữ liệu thật của 50 tủ (Zone 20 cùng 6 hành lang), giản đồ pha hiện trạng và đề xuất.

**Hạn chế chính** (sắp theo mức ảnh hưởng tới độ tin cậy của phương án đề xuất):

| # | Vấn đề | Ảnh hưởng | Cách xử lý trong TSO |
|---|---|---|---|
| 1 | **Chưa có ma trận rẽ.** Chế độ "xe vào: mọi nút" sinh dòng xe độc lập trên từng nhánh, nên đoàn xe xả từ nút thượng lưu không thực sự đi tiếp xuống nút hạ lưu. | Hiệu quả sóng xanh và offset bị đánh giá sai: dòng đến nút hạ lưu gần như đều theo thời gian, không phải theo đoàn. | Ước lượng ma trận rẽ bằng cân bằng **Furness/IPF** từ lưu lượng nhánh. Có hàng "nguồn giữa đoạn" và cột "ra khỏi mạng" để hấp thụ phần chênh lệch; ưu tiên đi thẳng hơn rẽ. |
| 2 | **Mô hình hàng chờ điểm (point-queue).** Hàng chờ không có chiều dài vật lý; "tràn ngược" chỉ là ngưỡng cảnh báo `Occ ≥ 75–85%`, không chặn dòng xả của nút thượng lưu. | Không tái hiện được hiện tượng khoá nút lan truyền (gridlock), vốn là rủi ro lớn nhất ở lõi trung tâm. | Thay bằng **mô hình truyền ô CTM** (Daganzo 1994/95): hàng chờ có chiều dài, sóng dừng/xả lan truyền ngược, và khi nhánh hạ lưu đầy thì nút thượng lưu bị chặn xả (ràng buộc FIFO). |
| 3 | **Mô phỏng "hạt" theo luật giảm tốc tuỳ ý** (`x += v·dt`, hệ số giảm tốc 24 m). | Không bảo toàn lưu lượng, không có ràng buộc năng lực. Chỉ tiêu 60 FPS/50.000 hạt là chỉ tiêu đồ hoạ, không phải chỉ tiêu nghiệp vụ. | Dùng CTM làm lõi tính toán; bản đồ tô màu theo từng ô (tỷ lệ mật độ trên mật độ tới hạn), thể hiện trung thực dòng thông thoáng, dồn ứ, hàng chờ và tràn. |
| 4 | **Công thức ràng buộc vòng MAXBAND ghi chưa đúng.** Tài liệu ghi `θ_j − θ_i + T_ij + T_ji = m·C`. | Thiếu biến vị trí dải `w, w̄` và thời gian đỏ `r, r̄` nên bài toán không đủ ràng buộc để giải. | Dạng rút gọn theo MAXBAND (Little, Kelson & Gartner 1981; thời gian tính bằng phần chu kỳ; bỏ pha rẽ trái và thời gian giải phóng hàng chờ): `(w_i + w̄_i) − (w_{i+1} + w̄_{i+1}) + (t_i + t̄_i) − m_i = r_{i+1} − r_i`, m_i nguyên. TSO tính **bề rộng dải chính xác** bằng giao cung xanh trên vòng chu kỳ và tìm offset rời rạc 1 s (mục 2.5). |
| 5 | **Bất nhất tham số.** `d_jam` = 2,5 m/pcu (Spec §3.1) nhưng 3,5 m/pcu (Algorithms §4.2). Suất dòng bão hoà S = 1,2 pcu/s "≈ 4.300 pcu/h" áp chung cho mọi nhánh. | Chiều dài hàng chờ và năng lực thông hành sai lệch theo từng nút. | S khai báo theo nhánh (hoặc bằng số làn × S cơ sở); cự ly kẹt tính theo làn. Tab Dữ liệu có công cụ nhân S hàng loạt để hiệu chỉnh. |
| 6 | **Đơn vị lưu lượng không rõ.** Giao diện ghi "xe/5 phút (hệ số PCU = 0,001)" và tốc độ phát xe = q × 0,001 pcu/s. Thực chất 0,001 ≈ 0,3 pcu/xe ÷ 300 s. | Dễ nhập sai số liệu. Với dữ liệu MVP1 sau quy đổi, nhiều nhánh có q ≈ 2.800–3.500 pcu/h trên S = 4.320 pcu/h, g/C ≈ 0,44, tức **x > 1 ở phần lớn trục chính**. Hoặc S đang bị đánh giá thấp, hoặc q bị đánh giá cao. | TSO thống nhất lưu q theo **pcu/h**. Bộ nhập Green Zone quy đổi q_pcu/h = q × pcu_per_q × 3600. Cần khảo sát suất dòng bão hoà thực tế (đo khoảng xả hàng chờ từ camera) trước khi dùng kết quả cho hiện trường. |
| 7 | **Chọn chu kỳ vùng.** Webster từng nút rồi lấy nút tới hạn. | Nút quá bão hoà kéo cả vùng lên chu kỳ tối đa, dù có thể xử lý cục bộ. | Quét C cho cả vùng, chọn theo **chỉ số hiệu suất mạng PI** (TRANSYT), có phạt chu kỳ dài để bảo vệ người đi bộ. Nút nhỏ được chạy **½ chu kỳ** (double cycling). |
| 8 | **Tiêu chuẩn viện dẫn.** Hệ số PCU dẫn TCVN 10380:2014, là tiêu chuẩn thiết kế đường giao thông nông thôn. | Hệ số quy đổi cho đường đô thị có thể khác. | Đề nghị đối chiếu **TCVN 13592:2022 (Đường đô thị – Yêu cầu thiết kế)** hoặc kết quả khảo sát riêng của thành phố. Trong TSO, hệ số PCU là tham số (mặc định: xe máy 0,3; ô tô 1,0; xe tải 2,0; xe buýt 2,5). |
| 9 | **Khoảng chuyển tiếp vàng/đỏ.** Chỉ nêu công thức ITE. | Thời gian vàng, đỏ toàn phần, xanh tối thiểu cho bộ hành phải phù hợp quy chuẩn và thiết kế tổ chức giao thông của từng nút. | TSO tính theo ITE làm giá trị tham khảo (vàng 3–5 s, đỏ toàn phần 1–4 s). Trước khi nạp tủ **cần đối chiếu QCVN 41:2024/BGTVT** (áp dụng từ 01/01/2025) và hồ sơ thiết kế nút. |
| 10 | **Bảo mật.** File MVP1 nhúng khoá truy cập Mapbox (`pk.…`) ngay trong HTML. | Khoá công khai vẫn có thể bị lạm dụng nếu chưa giới hạn tên miền. | Giới hạn URL cho token trên tài khoản Mapbox, hoặc dùng máy chủ ô bản đồ nội bộ. TSO cho phép khai báo URL nền bản đồ XYZ tuỳ ý và không lưu khoá trong mã. |
| 11 | **Kiến trúc.** Một tệp HTML 300 KB gồm dữ liệu, thuật toán và giao diện. | Khó kiểm thử, khó mở rộng lên 500 nút, khó cập nhật dữ liệu. | Tách thành các mô-đun (`js/*.js`), dữ liệu nằm ngoài mã (JSON/CSV), có **bộ kiểm thử tự động** (`npm test`). |
| 12 | **Tối ưu toàn cục bằng GA cho 500 nút.** | Không gian nghiệm quá lớn, hội tụ chậm, khó giải thích cho người vận hành. | Dùng **cấu trúc phân cấp**: vùng → hành lang (MAXBAND) → mạng vùng (TRANSYT leo đồi). GA/NSGA-II chỉ nên dùng tinh chỉnh vùng nhỏ khi cần tối ưu đa mục tiêu. |

---

## 2. Phương pháp đã hiện thực trong TSO

### 2.1. Ước lượng ma trận rẽ (Furness / IPF)
Tại mỗi nút, lập ma trận T có hàng là các nhánh vào i, thêm một hàng "nguồn". Cột là các nhánh ra j, thêm một cột "ra khỏi mạng".
- Tổng hàng i bằng q_i; tổng cột j bằng q_j.
- Hàng "nguồn" và cột "ra" hấp thụ chênh lệch Σq_vào − Σq_ra, cộng thêm 8% dự phòng cho hẻm và điểm đỗ.
- Trọng số mồi: đi thẳng (lệch hướng < 30°) là 1,0; rẽ là 0,35; quay đầu là 0.
- Lặp chuẩn hoá hàng/cột 40 lần.

Kết quả là tỷ lệ rẽ p_ij, tỷ lệ ra khỏi mạng và lưu lượng phát sinh giữa đoạn. Với mạng mẫu, sai số cân bằng dưới 2%.
Khi camera AI cung cấp số đếm hướng rẽ, có thể thay bằng số đo trực tiếp.

### 2.2. Tối ưu nút đơn
- Tỷ số dòng tới hạn: y_k = max(q/S) trên các nhánh do pha k phục vụ; Y = Σy_k.
- Thời gian tổn thất mỗi pha: l₁ + vàng + đỏ toàn phần − e (l₁ = 2 s khởi động, e = 2 s tận dụng vàng).
- Chu kỳ Webster: C₀ = (1,5L + 5)/(1 − Y). Chu kỳ tối thiểu khả thi: C_x = L/(1 − Y/x_mục tiêu).
- Split cân bằng độ bão hoà: g_k ∝ y_k, có ràng buộc xanh tối thiểu và làm tròn 1 s sao cho tổng đúng bằng C.
- Độ trễ theo HCM: d = d₁ + d₂, T = 0,25 h, k = 0,5. Mức phục vụ LOS A–F theo ngưỡng 10/20/35/55/80 s, và x > 1 thì xếp F.

### 2.3. Bộ đánh giá mạng kiểu TRANSYT (biểu đồ dòng chu kỳ)
- Dòng đến vạch dừng A_j(t) = Σ p_ij·D_i(t) (dòng đi của các nhánh thượng lưu), dịch thời gian β·T.
- Phân tán đoàn xe Robertson: F = 1/(1 + α·β·T), với α = 0,35 và β = 0,8 (tham số hoá).
- Hàng chờ điểm theo từng giây trong chu kỳ để tính trễ đều và số lần dừng. Cộng thêm trễ ngẫu nhiên/quá bão hoà d₂ (HCM).
- Chỉ số hiệu suất PI = Σ q·(d + K·h), K = 20 s/lần dừng.
- Nhanh hơn CTM hàng trăm lần (500 nút ≈ 0,1 s) nên dùng được trong vòng lặp tối ưu.

### 2.4. Phân vùng điều khiển (Louvain)
- Trọng số cạnh: w_uv = I_uv · exp(−|C_u − C_v|/25) · 1,5 nếu u, v liền kề trên cùng hành lang.
- Chỉ số ghép nối I_uv = (q_uv + q_vu)/L_uv (pcu/h/m). Chỉ xét cặp nút cách nhau ≤ 900 m.
- Thuật toán Louvain tối đa modularity với độ phân giải γ = 0,25. Vùng lớn hơn 35 nút được tách lại với γ tăng dần; vùng nhỏ hơn 5 nút được gộp vào vùng lân cận có ghép nối mạnh nhất.
- Mạng mẫu 500 nút cho khoảng **27–33 vùng**, mỗi vùng 5–35 nút. Muốn ít vùng hơn thì giảm γ hoặc tăng số nút tối đa mỗi vùng.

### 2.5. Sóng xanh hành lang
- **Nhận diện hành lang**: nối các nhánh cùng tên đường và lệch hướng ≤ 38°; tách theo biên vùng. Hành lang do người dùng khai báo (Ctrl+nhấp chuỗi nút rồi "Lưu làm hành lang") được ưu tiên.
- **GWS** = 0,35·Φ_dist + 0,30·Φ_turn + 0,20·Φ_cap + 0,15·Φ_geom, với:
  - Φ_dist: độ lệch của T so với bội số C/2.
  - Φ_turn: tỷ lệ dòng xuyên suốt, tính từ ma trận rẽ.
  - Φ_cap: độ đồng nhất xanh trục và tỷ lệ nút có x ≤ 0,9.
  - Φ_geom: chiều dài đoạn phù hợp, trong khoảng 120–800 m.
- **Phân cấp**: GWS ≥ 80 và đường hai chiều thì sóng xanh 2 chiều; GWS ≥ 55 thì 1 chiều ưu tiên hướng có lưu lượng lớn hơn trong khung giờ; thấp hơn thì không làm sóng xanh dài.
- **Tối ưu offset** theo mục tiêu MAXBAND: max w_đi·b_đi + w_về·b_về, với w_về/w_đi = q_về/q_đi (giới hạn 0,4–2,5).
  - Dải b tính chính xác theo độ phân giải 1 s.
  - Tìm kiếm toạ độ trên offset rời rạc, xuất phát từ nhiều điểm: sóng thuận, sóng ngược, cân bằng, ngẫu nhiên. Thêm tiêu chí phụ là dải của từng cặp nút liền kề để thoát vùng b = 0.
  - Hành lang dưới 30 nút giải trong vài chục ms.
- **Vận tốc khuyến nghị**: quét hệ số vận tốc ±10% và chọn vận tốc cho dải lớn nhất, dùng cho biển báo hoặc bảng VMS.

### 2.6. TRANSYT leo đồi toàn vùng
- Nhóm sóng xanh đã tối ưu được khoá lại và dịch offset cùng nhau như một khối. Các nút khác dịch riêng lẻ.
- Bước dịch: C/4, C/8, 5 s, 2 s, 1 s, theo hai chiều.
- Tinh chỉnh split ±2 s giữa các cặp pha của nút không nằm trên sóng xanh.
- Đánh giá cục bộ: chỉ tính lại các nhánh vào và ra của nhóm nút đang thử.

### 2.7. Mô phỏng CTM và điều khiển thích ứng
- Ô dài ≥ v_f·Δt; biểu đồ cơ bản tam giác lấy v_f từ số đo, Q = S, k_j = số làn/7 m.
- Tại nút: nhánh chỉ xả khi đang xanh hiệu dụng; phân nhánh theo p_ij với ràng buộc FIFO.
- Bốn chế độ điều khiển:
  1. **Cố định**: chạy theo giản đồ pha.
  2. **Xe kích hoạt**: theo xanh tối thiểu/tối đa, kết thúc pha khi hết hàng chờ gần vạch dừng.
  3. **Max Pressure** không theo chu kỳ (Varaiya 2013): áp lực chuẩn hoá theo sức chứa nhánh, chu kỳ quyết định 3 s, có trễ chuyển để tránh đổi pha liên tục.
  4. **Max Pressure chu kỳ cố định**: giữ nguyên C và offset để vẫn phối hợp được; split mỗi chu kỳ tỷ lệ với áp lực trung bình của chu kỳ trước, thay đổi tối đa ±4 s mỗi chu kỳ (theo tinh thần bộ tối ưu split của SCOOT).
- Chỉ tiêu đo: tổng trễ (xe·h), trễ/km, vận tốc trung bình, số lần dừng/km, thông lượng, số nhánh·phút tràn ngược, thời gian chờ vào mạng.

### 2.8. Bộ luật khuyến nghị phương án vận hành

| Điều kiện | Phương án đề xuất |
|---|---|
| Vùng có hành lang GWS ≥ 80, đường hai chiều | Vùng phối hợp chung C, **sóng xanh 2 chiều** trên trục, offset còn lại theo TRANSYT |
| Vùng có hành lang 55 ≤ GWS < 80 hoặc đường một chiều | Vùng phối hợp, **sóng xanh 1 chiều ưu tiên hướng cao điểm** (sáng: hướng vào; chiều: hướng ra, theo số liệu từng khung giờ) |
| Vùng có nhánh quá bão hoà (x > 0,95), hoặc lợi ích phối hợp dưới 3% PI, **và** CTM cho thấy thích ứng giảm trễ trên 5% | **Phối hợp + thích ứng** (Max Pressure chu kỳ cố định, kiểu SCOOT) |
| Nút độc lập, ghép nối yếu | **Xe kích hoạt / Max Pressure**. Nếu CTM không thấy lợi ích thì chạy cố định theo Webster theo từng khung giờ |
| Hành lang GWS < 55 | Không làm sóng xanh dài; điều khiển theo vùng hoặc tách thành cụm ngắn. Phần mềm nêu thành phần GWS yếu nhất để người vận hành biết nguyên nhân |

Các khuyến nghị thích ứng đều được **kiểm chứng bằng mô phỏng CTM** (cố định so với thích ứng tại vùng ứng viên) trước khi đưa ra.

---

## 3. Kết quả thử nghiệm

### 3.1. Mạng mẫu 500 nút (dữ liệu giả lập), khung cao điểm sáng

| Chỉ tiêu | Hiện trạng | Đề xuất | Thay đổi |
|---|---|---|---|
| Trễ trung bình theo TRANSYT (s/pcu) | 20,2 | 13,3 | −34% |
| Trễ trung bình theo HCM (s/pcu) | 20,1 | 14,2 | −29% |
| x lớn nhất | 1,53 | 1,18 | −23% |
| Tổng trễ theo CTM, 30 phút (xe·h) | 2.444 | 1.509 | −38% |
| Tràn ngược theo CTM (nhánh·phút) | 31 | 1 | −97% |

Thời gian chạy toàn bộ pipeline cho 500 nút, 1.670 nhánh là khoảng 13–15 giây trên trình duyệt, kể cả bước kiểm chứng CTM.

### 3.2. Dữ liệu MVP1 (50 tủ, nhập trực tiếp từ Green Zone Player)
- Trễ trung bình theo TRANSYT: hiện trạng 165,9 s/pcu; đề xuất của MVP1 159,5 s/pcu; đề xuất của TSO 64,0 s/pcu.
- Mức trễ rất cao ở cả ba phương án xác nhận vấn đề đơn vị và suất dòng bão hoà nêu ở mục 1, dòng 6.
- **Cần hiệu chỉnh S và q bằng khảo sát trước khi so sánh định lượng.**

---

## 4. Lộ trình khuyến nghị đưa vào vận hành

1. **Chuẩn hoá dữ liệu** (tháng 1–2):
   - Số đếm 15 phút theo **hướng tiếp cận và hướng rẽ** từ 400 camera AI, có phân loại phương tiện, quy đổi ra pcu/h.
   - Giản đồ pha hiện trạng xuất từ tủ OMNIA/ATC.
   - Nạp vào TSO qua các mẫu CSV.
2. **Hiệu chỉnh mô hình** (tháng 2–3):
   - Đo suất dòng bão hoà thực tế: khoảng xả hàng chờ đo từ camera tại 20–30 nút đại diện.
   - Kiểm định lưu lượng mô phỏng so với số đếm bằng chỉ số **GEH < 5 cho ≥ 85% nhánh**.
   - Kiểm định thời gian hành trình mô phỏng so với dữ liệu GPS hoặc camera nhận dạng biển số trên các trục chính, chênh lệch ≤ 15%.
3. **Thí điểm** (tháng 4–5): 1 vùng và 2 hành lang, ví dụ Nam Kỳ Khởi Nghĩa và Hai Bà Trưng.
   - Đánh giá trước/sau bằng thời gian hành trình, số lần dừng và chiều dài hàng chờ đo từ camera.
   - Lưu ý cơ chế **chuyển kế hoạch giữa khung giờ**: bộ điều khiển cần hỗ trợ chuyển offset mượt qua vài chu kỳ.
4. **Mở rộng** (tháng 6 trở đi): toàn mạng 500 nút, theo khung giờ. Khu vực được khuyến nghị thích ứng thì triển khai logic Max Pressure hoặc SCOOT trên hệ thống trung tâm.

---

## 5. Giới hạn hiện tại và hướng phát triển
- Mô hình ở mức **nhánh tiếp cận**: một nhánh được phục vụ bởi một hoặc nhiều pha. Chưa tách làn rẽ trái bảo vệ, pha chồng (overlap) hay pha bộ hành riêng. Có thể mở rộng thành mô hình theo **hướng rẽ (movement)** khi có số đếm hướng rẽ.
- Tối ưu offset dùng tìm kiếm rời rạc thay cho MILP chính xác. Có thể thêm bộ giải MILP (ví dụ HiGHS biên dịch WASM) cho hành lang trọng điểm.
- Xuất mạng sang **SUMO** để kiểm định vi mô cho các nút phức tạp.
- Chuyển phần tính toán nặng sang Web Worker khi chạy qua máy chủ web nội bộ.
- Kết nối trực tiếp API OMNIA/ATC, hoặc đối tượng NTCIP 1202 về thời gian pha, để đọc và ghi giản đồ.
- Theo dõi thời gian thực: nạp lưu lượng 5–15 phút từ camera để chạy lại tối ưu split theo cơ chế cuốn chiếu (rolling horizon).

## Tài liệu tham khảo
- Webster, F.V. (1958). *Traffic Signal Settings*. Road Research Technical Paper 39.
- Transportation Research Board (2010/2016). *Highway Capacity Manual*, Chương đèn tín hiệu.
- Robertson, D.I. (1969). *TRANSYT: a traffic network study tool*. RRL Report LR 253.
- Little, J.D.C., Kelson, M.D., Gartner, N.H. (1981). MAXBAND: A program for setting signals on arteries and triangular networks. *TRR 795*.
- Daganzo, C.F. (1994, 1995). The cell transmission model, parts I–II. *Transportation Research Part B*.
- Varaiya, P. (2013). Max pressure control of a network of signalized intersections. *Transportation Research Part C* 36.
- Blondel, V.D. et al. (2008). Fast unfolding of communities in large networks. *J. Stat. Mech.*
- Institute of Transportation Engineers. *Traffic Signal Timing Manual* (khoảng chuyển tiếp vàng/đỏ).
