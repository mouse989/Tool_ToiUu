# HƯỚNG DẪN SỬ DỤNG — TSO · Tối ưu Tín hiệu Mạng lưới

## 1. Khởi chạy
Phần mềm là ứng dụng web tĩnh, không cần cài đặt hay cơ sở dữ liệu.

- **Windows**: nhấp đúp `chay_ung_dung.bat`. Tệp này mở máy chủ web cục bộ bằng Python hoặc Node, rồi mở trình duyệt tại `http://localhost:8080`.
- **Cách khác**: mở thẳng `index.html` bằng Chrome/Edge. Nền bản đồ mặc định là **CARTO Voyager** (dữ liệu OpenStreetMap), chạy được cả khi mở kiểu `file://`. Máy chủ ô của OpenStreetMap chặn yêu cầu không có Referer (hiện ô "403 Access blocked"), nên chỉ chọn nền OSM khi chạy qua máy chủ web; nếu đang mở `file://` phần mềm tự chuyển sang CARTO. Có thể khai báo máy chủ GIS nội bộ ở tab Dữ liệu.
- **Máy không có Internet**: bỏ chọn "Nền bản đồ"; mạng lưới vẫn hiển thị theo toạ độ.

Lần đầu mở, phần mềm nạp **mạng mẫu 500 nút giả lập** để chạy thử. Dự án đang làm được tự lưu trong trình duyệt.

## 2. Bố cục màn hình
- **Thanh trên**: tên dự án, chọn **khung giờ**, xem **Hiện trạng / Đề xuất**, các menu Mới, Mở, Lưu, Nhập, Xuất, và nút giao diện sáng/tối.
- **Cột trái** gồm 4 thẻ: Dữ liệu · Tối ưu · Mô phỏng · Báo cáo.
- **Bản đồ**:
  - Công cụ: Chọn · + Nút · + Nhánh · Di chuyển.
  - Tô màu theo v/c, LOS, độ trễ, lưu lượng, nguồn số liệu hoặc vùng.
  - Ô tìm mã nút / tên đường; nút ⤢ để xem toàn mạng.
- **Khung dưới**: biểu đồ thời gian – khoảng cách (TSD), diễn biến mô phỏng, đường cong chu kỳ vùng.
- **Cột phải**: thuộc tính của nút, nhánh hoặc vùng đang chọn.

## 3. Nhập dữ liệu cho 500 nút
1. Chuẩn bị các file theo `docs/DINH_DANG_DU_LIEU.md`:
   - nút (toạ độ);
   - giản đồ pha hiện trạng theo khung giờ;
   - nhánh tiếp cận có lưu lượng và vận tốc, hoặc số đếm theo hướng tiếp cận.
2. **Mới ▾ → Dự án trống**, sau đó **Nhập ▾ → Nhập CSV** và chọn tất cả các file.
3. Thẻ **Dữ liệu**:
   - **Kiểm tra dữ liệu** để xem lỗi (thiếu toạ độ, pha vượt số pha, vàng < 3 s…).
   - **Bù dữ liệu thiếu** cho các nhánh chưa có trạm đo: lấy trung bình cùng tuyến, nếu không có thì lấy trung vị toàn mạng. Giá trị bù hiển thị chữ nghiêng.
   - **Vàng/đỏ ITE toàn mạng** nếu chưa có số liệu khoảng chuyển tiếp.
   - **Gán pha theo hướng** nếu chưa khai báo cột `pha`: Bắc–Nam là pha 1, Đông–Tây là pha 2.
4. Sửa thủ công: nhấp một nút trên bản đồ, cột phải cho sửa:
   - thời lượng **xanh / vàng / đỏ toàn phần** từng pha, offset, thêm hoặc bớt pha;
   - **lưu lượng q, vận tốc v, số làn, pha phục vụ** của từng hướng tiếp cận;
   - chế độ điều khiển của tủ.

   Sửa hàng loạt tại **Bảng nút & giản đồ pha** và **Bảng nhánh & lưu lượng**.
5. Vẽ mới trên bản đồ: **+ Nút** rồi nhấp lên bản đồ; **+ Nhánh** rồi nhấp nút đầu và nút cuối (giữ Shift để tạo nhánh 1 chiều); **Di chuyển** để kéo nút.

Đã có dữ liệu MVP1 thì chỉ cần **Mở…** file `index.html` cũ của Green Zone Player.

## 4. Chạy tối ưu
Thẻ **Tối ưu**:
1. Kiểm tra thiết lập: chu kỳ tối thiểu/tối đa, phạt dừng K, kích thước vùng, ngưỡng GWS, lưu lượng tối thiểu để xét sóng xanh.
2. Bấm **Tối ưu khung giờ này**, hoặc **Tối ưu mọi khung giờ**. Mạng 500 nút mất khoảng 15 giây cho mỗi khung giờ.
3. Đọc kết quả:
   - **Bảng so sánh** hiện trạng và đề xuất: trễ, dừng, PI, x lớn nhất, nguy cơ tràn.
   - **Vùng điều khiển**: nhấp một vùng để phóng tới vùng đó, xem đường cong trễ theo C ở khung dưới và thông tin ở cột phải.
   - **Hành lang sóng xanh**: GWS và loại (2 chiều / 1 chiều / không). Nhấp để mở **biểu đồ TSD**:
     - thanh xanh/đỏ từng nút: nửa trên là chiều đi, nửa dưới là chiều về;
     - dải xanh dương là dải đi, dải tím là dải về;
     - **kéo thanh đèn sang trái/phải để chỉnh offset bằng tay**, dải được tính lại ngay.
   - **Khuyến nghị vận hành**: phương án cho từng vùng (phối hợp + sóng xanh, phối hợp TRANSYT, phối hợp + thích ứng, độc lập thích ứng/cố định) và từng hành lang, có nêu lý do.
4. Chuyển **Hiện trạng / Đề xuất** trên thanh trên để so sánh màu v/c và LOS trên bản đồ.
5. **Áp dụng đề xuất → hiện trạng** khi đã duyệt. Nên xuất phiếu cài đặt tủ trước.

Hành lang tự chọn: giữ **Ctrl** và nhấp lần lượt các nút liên tiếp → **Vẽ TSD** hoặc **Lưu làm hành lang**. Hành lang đã lưu được bộ tối ưu ưu tiên khi chạy lại.

## 5. Mô phỏng và đối sánh
Thẻ **Mô phỏng**:
- Chọn kịch bản: Hiện trạng · Đề xuất cố định · Đề xuất + thích ứng theo khuyến nghị · Max Pressure chu kỳ cố định toàn mạng · Max Pressure không chu kỳ · Xe kích hoạt.
- **▶ Chạy hoạt ảnh**: xem dòng xe theo từng ô CTM.
  - Màu: xanh là thông thoáng; vàng là giảm tốc; cam là dồn ứ; đỏ là hàng chờ; đỏ sẫm là kẹt cứng hoặc tràn.
  - Vạch màu tại vạch dừng là trạng thái đèn.
  - Nếu đang mở một hành lang, biểu đồ TSD chuyển sang nền **mật độ mô phỏng thực tế**, cho thấy sóng dừng/xả và dải xanh.
- **Đối sánh A/B**: chạy nhanh hai kịch bản (khởi động 10 phút, đo 30 phút) và so sánh tổng trễ, vận tốc, số lần dừng, thông lượng, tràn ngược, chờ vào mạng. Diễn biến theo thời gian xem ở khung dưới.
- Kiểm tra độ bền phương án: **hệ số nhu cầu** (ví dụ ×1,1) và **dao động nhu cầu CV** (ví dụ 0,15).

### Xe vào – ra mạng (cơ chế phát sinh / thu hút chuyến đi)
Xe vào mạng theo ba cách:
- từ **nhánh biên** (cửa ngõ, nút ngoài cùng);
- **phát sinh giữa đoạn**: xe từ nhà ở, cơ quan, bãi đỗ, hẻm đi ra đường;
- từ nút thượng lưu đi xuống.

Xe ra mạng theo hai cách:
- đi hết **nhánh biên** thì rời mạng;
- **kết thúc chuyến giữa đoạn**: sau khi qua nút, một phần xe rẽ vào nhà, văn phòng, TTTM, bãi đỗ. Phần xe này không phải chờ đèn tại nút kế tiếp.

Tỷ lệ trao đổi này được ước lượng từ số đếm (cân bằng Furness) và phụ thuộc **loại khu vực quanh nút**, chọn ở cột phải khi nhấp một nút hoặc qua cột `su_dung_dat` trong CSV:

| Loại khu vực | Tỷ lệ trao đổi |
|---|---|
| Thông thường | 8% |
| Dân cư | 15% |
| Văn phòng | 15% |
| TTTM / chợ | 22% |
| Trường học / bệnh viện | 18% |
| Bãi đỗ / bến xe | 35% |
| Cửa ngõ | 50% |

Theo dõi cân bằng xe khi mô phỏng:
- **HUD trên bản đồ**: xe vào / ra (pcu/h), kèm nhãn *cân bằng*, *tích luỹ* hoặc *đang thoát*.
- **Khung dưới → Diễn biến mô phỏng → "Cân bằng xe vào / ra mạng"**: nét liền là vào, nét đứt là ra.
- **Chọn một vùng** (thẻ Tối ưu → bảng Vùng) khi đang mô phỏng, cột phải hiện **cân bằng xe của vùng**: vào qua biên, phát sinh trong vùng, ra qua biên, kết thúc chuyến trong vùng, và phần tích luỹ.

Cách đọc:
- Mạng bắt đầu trống nên **15–20 phút đầu số xe luôn tăng** (giai đoạn lấp đầy), sau đó vào ≈ ra.
- Nếu tích luỹ vẫn tăng mãi, tức nhu cầu vượt năng lực: vùng quá bão hoà hoặc có tràn ngược. Cần kiểm tra lại số liệu q, S hoặc phương án đèn.
- Chọn **Hồ sơ nhu cầu "Dạng đỉnh"** để mô phỏng giờ cao điểm tăng rồi giảm, và quan sát hàng chờ tan dần sau đỉnh.

## 6. Báo cáo, xuất dữ liệu
- **Phiếu cài đặt tủ (CSV)**: C, offset, xanh từng pha hiện trạng → đề xuất theo khung giờ, vùng và phương án.
- **Báo cáo phương án (HTML)**: phương pháp, bảng chỉ tiêu, vùng, hành lang, khuyến nghị, giản đồ đề xuất. Có thể in ra PDF.
- **Lưu** dự án (.json) để trao đổi hoặc lưu hồ sơ.

## 7. Tham số kỹ thuật chính
| Tham số | Mặc định | Ghi chú |
|---|---|---|
| S cơ sở | 1.800 pcu/h/làn | Nên hiệu chỉnh theo khảo sát khoảng xả hàng chờ |
| Cự ly kẹt | 7 m/pcu/làn | ≈ 3,5 m/pcu cho mặt cắt 2 làn dòng hỗn hợp |
| Xanh tối thiểu | 15 s | Sàn cho bộ hành khu trung tâm |
| l₁ / e | 2 s / 2 s | Tổn thất khởi động / phần vàng vẫn dùng để xả (HCM) |
| α, β Robertson | 0,35 / 0,8 | Phân tán đoàn xe |
| K phạt dừng | 20 s/lần | Trọng số số lần dừng trong PI |
| Ngưỡng tràn ngược | 0,8 | Tỷ lệ chiếm dụng liên kết |
| γ phân vùng | 0,25 | Nhỏ hơn thì vùng lớn hơn và ít vùng hơn |
| GWS 2 chiều / 1 chiều | 80 / 55 | |
| q tối thiểu sóng xanh | 1.000 pcu/h (2 chiều) | Trục có lưu lượng thấp hơn để TRANSYT xử lý |

## 8. Lưu ý an toàn khi áp dụng hiện trường
Kết quả là **đề xuất kỹ thuật dựa trên mô hình**. Trước khi nạp tủ cần:
1. hiệu chỉnh mô hình bằng số đếm và thời gian hành trình;
2. đối chiếu khoảng chuyển tiếp và xanh tối thiểu bộ hành với **QCVN 41:2024/BGTVT** và thiết kế tổ chức giao thông của từng nút;
3. kiểm tra ma trận xung đột pha trên tủ;
4. thí điểm trên phạm vi nhỏ và đánh giá trước/sau.
