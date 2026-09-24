# NGHIÊN CỨU ỨNG DỤNG AI / LLM ĐỂ TỐI ƯU CHU KỲ VÀ THỜI GIAN XANH NGÀY CÀNG TỐT HƠN

## 1. Quy trình tối thiểu cho người vận hành
Chỉ cần 4 bước. Hệ thống tự tính chu kỳ, split, offset và đề xuất phương án vận hành.

1. **Dựng mạng lưới**: lấy từ OSM theo vùng vẽ, hoặc nhập CSV, hoặc vẽ tay.
2. **Nhập lưu lượng** các nhánh theo khung giờ: CSV nhánh, CSV hướng tiếp cận có số đếm phân loại, hoặc bảng nhánh.
3. **Đánh dấu nút có đèn** bằng công cụ 🚦 Gắn đèn. Nhánh vào được tự gán pha theo trục đường.
4. **Đặt đèn mặc định** ở thẻ Dữ liệu → *Đèn tín hiệu mặc định*: vàng, đỏ toàn phần, xanh min/max → **Áp cho mọi nút có đèn**.
   - Tuỳ chọn: **Khởi tạo giản đồ theo lưu lượng** (Webster) để có phương án "hiện trạng" hợp lý khi chưa có số liệu tủ.

Tiếp theo:
- **Tối ưu** (thẻ Tối ưu): phân vùng, chọn chu kỳ vùng theo PI, sóng xanh MAXBAND, offset và split theo TRANSYT, kiểm chứng CTM, khuyến nghị phương án.
- **Tối ưu nâng cao – chạy thử & hiệu chỉnh lặp (AI)**: tinh chỉnh tiếp bằng vòng lặp mô phỏng (mục 2).

## 2. Nguyên lý "chạy thử – hiệu chỉnh lặp" đã hiện thực

```
      ┌────────────── đề xuất điều chỉnh (thuật toán / AI) ◄───────────────┐
      ▼                                                                    │
  Giản đồ ứng viên ──► Mô phỏng CTM (thước đo) ──► J = trễ + K·dừng + tràn │
                                                         │                 │
                                    tốt hơn? ── có ──► giữ lại ────────────┘
                                             └─ không ─► loại, ghi nhận phản hồi
```

- **Thước đo thống nhất J** (xe·h tương đương) = tổng trễ + K·số lần dừng/3600 + 0,2·(nhánh·phút tràn ngược) + thời gian chờ vào mạng.
  Mọi thay đổi đều phải **qua mô phỏng**. Không có đề xuất nào được ghi vào phương án nếu không làm J giảm.
- **Ràng buộc an toàn cứng** (được chiếu lại sau mỗi đề xuất): xanh ≥ xanh tối thiểu; tổng xanh = C − Σ(vàng + đỏ toàn phần); vàng và đỏ toàn phần giữ nguyên; offset ∈ [0, C).
  Chu kỳ vùng giữ nguyên để không phá phối hợp sóng xanh.

### 2.1. SPSA – tối ưu ngẫu nhiên xấp xỉ gradient (không cần Internet)
- SPSA (Simultaneous Perturbation Stochastic Approximation, Spall 1992) đo độ dốc của J theo **hàng trăm biến cùng lúc** (offset + xanh từng pha của mọi nút) chỉ bằng **2 lần chạy mô phỏng mỗi vòng**. Đây là kỹ thuật chuẩn cho tối ưu dựa trên mô phỏng giao thông.
- Cải tiến trong TSO:
  - chỉ nhiễu một **khối nút ngẫu nhiên** (15%) mỗi vòng, giảm nhiễu gradient khi số biến lớn;
  - bước giảm dần;
  - giới hạn ±4 s mỗi vòng;
  - **quay về nghiệm tốt nhất** khi đi lệch;
  - luôn giữ nghiệm tốt nhất đã thấy.
- Kết quả thử trên mạng mẫu 150 nút (khung sáng, mô phỏng 15 phút mỗi lần thử):

  | Điểm xuất phát | Số vòng | J giảm |
  |---|---|---|
  | Giản đồ hiện trạng | 40 | 3,5% |
  | Phương án đã tối ưu TRANSYT | 40 | thêm 2,1% |
  | Tiếp đó, chỉ 25% nút kém nhất | 30 | thêm 1% |

  Mức giảm nhỏ ở hai dòng sau là **dấu hiệu tốt**: phương án TRANSYT đã gần tối ưu; SPSA sửa phần sai lệch giữa mô hình giải tích và mô phỏng (hàng chờ vật lý, tràn ngược).

### 2.2. Cố vấn AI (LLM – Claude) trong vòng lặp
- Mỗi vòng, hệ thống gửi cho mô hình một bảng JSON gọn:
  - chỉ số mạng: J, trễ, vận tốc, tỷ lệ dừng, tràn ngược;
  - **15 nút kém nhất theo trễ mô phỏng/xe**, mỗi nút kèm giản đồ pha, từng nhánh vào (hướng, tên đường, q, S, x, trễ, thời gian hành trình) và nút hạ lưu.
- Mô hình trả về JSON: nhận định bằng tiếng Việt và tối đa 8 hành động (split hoặc offset) **kèm lý do**.
- Hệ thống áp **từng** hành động và chạy mô phỏng: nhận nếu J giảm, loại nếu không. Kết quả (ΔJ, nhận/loại) được **gửi lại cho mô hình** ở vòng sau, để mô hình học từ phản hồi trong cùng phiên.
- Điểm mạnh:
  - lời giải thích dễ hiểu cho người vận hành;
  - kết hợp được tri thức chuyên gia: điều tiết dòng vào, ưu tiên trục chính, xử lý nút tràn ngược;
  - linh hoạt với tình huống bất thường.
- Điểm yếu: chậm và tốn phí hơn SPSA; chất lượng phụ thuộc dữ liệu đưa vào. Vì vậy **LLM chỉ đề xuất, mô phỏng mới quyết định**.
- Kỹ thuật: dùng SDK chính thức `@anthropic-ai/sdk` chạy trong trình duyệt, mô hình mặc định `claude-opus-5`, suy luận thích ứng.
  - Đã bật cơ chế **dự phòng phía máy chủ** (`fallbacks: "default"`): khi mô hình từ chối một yêu cầu thì tự chạy lại trên mô hình dự phòng.
  - Khoá API chỉ lưu trên máy người dùng (tuỳ chọn), không ghi vào file dự án. Không gửi toạ độ.
- Khuyến nghị bảo mật khi triển khai chính thức: đặt một **máy chủ trung gian nội bộ** giữ khoá API, không để khoá trên trình duyệt của từng máy trạm.

## 3. Lộ trình để hệ thống "càng ngày càng tốt hơn"

| Giai đoạn | Nội dung | Dữ liệu cần | Kỳ vọng |
|---|---|---|---|
| **A. Hiệu chỉnh mô hình (bắt buộc trước)** | Tự hiệu chỉnh S (suất dòng bão hoà), v, tỷ lệ ra/vào, ma trận rẽ để lưu lượng mô phỏng khớp số đếm (GEH < 5 cho ≥ 85% nhánh) và thời gian hành trình khớp GPS/camera (sai số ≤ 15%) | Số đếm 15 phút theo hướng từ 400 camera AI; thời gian hành trình | Mô hình phản ánh đúng hiện trường; mọi tối ưu sau mới có giá trị |
| **B. Tối ưu lặp theo mô phỏng (đã có)** | TRANSYT → SPSA → cố vấn LLM; chạy định kỳ cho từng khung giờ, tuần | Như A | Giảm thêm vài % trễ, loại bỏ điểm tràn ngược |
| **C. Vòng lặp dữ liệu thật (trước/sau)** | Mỗi phương án nạp tủ được đánh giá lại bằng dữ liệu camera tuần sau; kết quả thực tế cập nhật lại tham số (A) và được lưu làm "bài học" cho cố vấn LLM | Nhật ký phương án + KPI thực đo | Mô hình và kho tri thức ngày càng sát thực tế |
| **D. Mô hình thay thế (surrogate) / tối ưu Bayes** | Học mạng nơ-ron hoặc Gaussian Process xấp xỉ J(giản đồ) từ hàng nghìn lần chạy CTM, rồi tối ưu trên mô hình thay thế nhanh gấp nhiều lần | Kho kết quả mô phỏng tích luỹ từ B | Tối ưu được cả chu kỳ vùng, số pha, trình tự pha |
| **E. Học tăng cường (RL) đa tác tử** | Mỗi nút / vùng là một tác tử học chính sách chọn pha / split từ trạng thái hàng chờ (tham chiếu: Max Pressure làm chuẩn so sánh; các hướng PressLight, CoLight, MPLight trong nghiên cứu) | Mô phỏng đã hiệu chỉnh (A) để huấn luyện; camera thời gian thực để chạy | Điều khiển thích ứng vượt Max Pressure ở mạng phức tạp; cần thử nghiệm kỹ "sim-to-real" trước khi dùng thật |
| **F. Trợ lý vận hành LLM** | LLM đọc cảnh báo (tràn ngược, sự cố, sự kiện), gợi ý kịch bản ứng phó, soạn báo cáo; luôn qua mô phỏng và người duyệt | Nhật ký vận hành, dữ liệu sự cố | Rút ngắn thời gian phản ứng, chuẩn hoá quy trình |

**Nguyên tắc an toàn áp dụng cho mọi phương pháp AI:**
1. Ràng buộc cứng (xanh tối thiểu bộ hành, vàng/đỏ theo quy chuẩn, ma trận xung đột) do phần mềm kiểm soát, AI không được vượt.
2. Mọi đề xuất phải qua mô phỏng đã hiệu chỉnh.
3. Người vận hành duyệt trước khi nạp tủ; có kế hoạch quay lui.
4. Thí điểm phạm vi nhỏ, đánh giá trước/sau bằng dữ liệu thật.

## 4. Gợi ý đề tài nghiên cứu cấp cơ sở
1. Hiệu chỉnh tự động suất dòng bão hoà dòng xe hỗn hợp (xe máy chiếm ưu thế) từ video camera AI tại nút có đèn TP.HCM.
2. So sánh TRANSYT + SPSA với Max Pressure và điều khiển thích ứng kiểu SCOOT trên mạng 500 nút đã hiệu chỉnh.
3. Trợ lý LLM trong vòng lặp mô phỏng: độ tin cậy, chi phí, khả năng giải thích; đánh giá bằng tỷ lệ đề xuất được mô phỏng chấp nhận.
4. Học tăng cường đa tác tử cho vùng lõi trung tâm (Quận 1, Quận 3), kiểm chứng bằng thí điểm có kiểm soát.

## Tài liệu tham khảo
- Spall, J.C. (1992). Multivariate stochastic approximation using a simultaneous perturbation gradient approximation. *IEEE Transactions on Automatic Control* 37(3).
- Varaiya, P. (2013). Max pressure control of a network of signalized intersections. *Transportation Research Part C* 36.
- Daganzo, C.F. (1994). The cell transmission model. *Transportation Research Part B* 28(4).
- Robertson, D.I. (1969). TRANSYT: a traffic network study tool. RRL Report LR 253.
