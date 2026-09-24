# HƯỚNG DẪN SỬ DỤNG — TSO · Tối ưu Tín hiệu Mạng lưới

## 1. Khởi chạy
Phần mềm là ứng dụng web tĩnh, không cần cài đặt hay cơ sở dữ liệu.

- **Windows**: nhấp đúp `chay_ung_dung.bat`. Tệp này mở máy chủ web cục bộ bằng Python hoặc Node, rồi mở trình duyệt tại `http://localhost:8080`.
- **Cách khác**: mở thẳng `index.html` bằng Chrome/Edge. Nền bản đồ mặc định là **OpenStreetMap**. Khi mở kiểu `file://`, máy chủ OSM có thể từ chối (hiện ô "403 Access blocked") vì trình duyệt không gửi Referer; khi đó chạy qua `chay_ung_dung.bat` (http://localhost:8080) hoặc chọn nền CARTO dự phòng ở tab Dữ liệu. Có thể khai báo máy chủ GIS nội bộ ở cùng chỗ.
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
   Bảng nút có 3 chế độ xem:
   - **Hiện trạng**: giản đồ đang cài ngoài tủ, sửa trực tiếp được.
   - **Đề xuất**: giản đồ do bộ tối ưu tính, có cột Vùng, ký hiệu ½ = nút chạy nửa chu kỳ vùng; sửa trực tiếp được.
   - **So sánh**: mỗi ô hiện `hiện trạng → đề xuất`; thời gian xanh tăng tô xanh ▲, giảm tô đỏ ▼. Chỉ xem.
   Ô lọc nhận mã nút, tên hoặc mã vùng (ví dụ `V07`) để xem riêng một vùng phối hợp.
5. Vẽ mới trên bản đồ: **+ Nút** rồi nhấp lên bản đồ; **+ Nhánh** rồi nhấp nút đầu và nút cuối (giữ Shift để tạo nhánh 1 chiều); **Di chuyển** để kéo nút.

Đã có dữ liệu MVP1 thì chỉ cần **Mở…** file `index.html` cũ của Green Zone Player.

## 3b. Dựng mạng lưới từ OpenStreetMap (OSM) theo vùng vẽ
1. Bấm **⬠ Vùng OSM** trên thanh công cụ bản đồ, hoặc **Nhập ▾ → Lấy mạng đường OSM theo vùng vẽ**.
2. Nhấp lần lượt các đỉnh của vùng cần lấy dữ liệu. Thanh công cụ hiện số đỉnh và diện tích; dùng **↶ Bớt đỉnh** hoặc **Xoá** để sửa.
3. Bấm **Tải mạng OSM…** rồi chọn:
   - **Cấp đường**: mặc định từ tertiary trở lên. Đường dân cư làm mạng rất dày, chỉ nên chọn khi cần.
   - **Bán kính gộp nút R**: mặc định 30 m, gộp đường đôi, dải phân cách, nút phức hợp thành một nút giao.
   - Giữ hay không giữ đèn giữa đoạn.
   - Điền lưu lượng mặc định theo cấp đường.
   - Tạo dự án mới hoặc thêm vào dự án hiện tại.
4. Phần mềm tải dữ liệu qua **Overpass API** (cần Internet; lần lượt thử overpass-api.de, overpass.kumi.systems, overpass.private.coffee) và dựng mạng:
   - chỉ lấy đường **nằm trong vùng**; điểm cắt biên trở thành nút **cửa ngõ**;
   - tách tuyến tại điểm giao, **gộp điểm giao gần nhau** thành một nút, **rút gọn** các điểm gấp khúc hoặc đổi tên đường (nút bậc 2 không có đèn);
   - chiều đi theo `oneway` (kể cả `-1` và vòng xoay); **số làn** từ `lanes`, `lanes:forward/backward`, nếu thiếu thì từ `width` hoặc mặc định theo cấp đường; vận tốc từ `maxspeed` hoặc theo cấp đường; chiều dài tính theo hình học thực;
   - **đèn tín hiệu** lấy từ thẻ `highway=traffic_signals`. Ở TP.HCM thẻ này thường đặt tại vạch dừng, lệch tâm nút 10–30 m, nên được gán về nút giao gần nhất.
5. Không có Internet thì tải dữ liệu OSM bằng công cụ khác (JOSM, trang Overpass Turbo → Export) rồi dùng **Nhập ▾ → Nhập file OSM (.osm / .json)**. Nếu đang có vùng vẽ, phần mềm chỉ lấy phần nằm trong vùng.

### Gắn đèn và nhận biết nhánh ↔ pha
- Bấm **🚦 Gắn đèn** rồi nhấp vào nút giao để **gắn hoặc gỡ đèn**. Có thể đổi ô "Có đèn" ở cột phải cho kết quả tương tự.
- Khi gắn đèn, phần mềm tự nhận biết các **nhánh vào nút** và nhóm chúng theo **trục đường**:
  - hướng tiếp cận được tính theo đoạn cuối của tuyến, nên đúng cả với lưới đường xiên hoặc đường cong;
  - trục chính (nhiều làn, cấp cao) là **pha 1**, trục cắt ngang là **pha 2**; nút 5–6 nhánh có **pha 3**;
  - giản đồ mặc định được tạo cho mọi khung giờ.
- Chọn một nút có đèn: các nhánh vào được **tô màu theo pha** và gắn nhãn P1, P2… ngay trên bản đồ. Bảng "Nhánh tiếp cận" ở cột phải cho sửa pha của từng nhánh, ví dụ `1;3` cho rẽ trái có pha riêng.
- Nút "**Gán pha theo trục**" trong cột phải làm lại việc nhóm pha cho nút đang chọn.
- Nút **không có đèn** được mô phỏng như nút ưu tiên: xe qua theo năng lực nhánh.

### Chỉnh hình dạng nhánh (đường cong, quẹo)
- Bấm **〰 Sửa nhánh** rồi nhấp chọn một nhánh. Hoặc chọn nhánh bằng công cụ Chọn, rồi bấm "〰 Sửa hình dạng" ở cột phải.
- Trên nhánh hiện các loại điểm:
  - **điểm cam** là điểm uốn: kéo để di chuyển;
  - **⊕ giữa mỗi đoạn**: kéo để **thêm điểm uốn mới**;
  - **nhấp phải hoặc nhấp đúp** vào điểm cam để xoá;
  - hai điểm đầu mút màu xám gắn với nút giao; di chuyển nút bằng công cụ Di chuyển.
- Mặc định **sửa đồng thời chiều ngược** của cùng tuyến. Bỏ chọn ô này ở cột phải nếu hai chiều đi hai tuyến khác nhau, ví dụ đường đôi tách xa.
- Sau khi sửa, **chiều dài nhánh tính lại theo hình dạng mới**, kéo theo thời gian hành trình, sóng xanh, số ô mô phỏng CTM. Nếu nhánh đang dùng chiều dài nhập tay L, bấm "Dùng chiều dài hình học" để chuyển sang chiều dài đo theo hình dạng.
- Các nút khác ở cột phải: **Làm thẳng** (xoá mọi điểm uốn), **Chép sang chiều ngược**.
- Hướng tiếp cận của nhánh (Bắc/Nam/Đông/Tây, nhóm pha theo trục, nhận biết đi thẳng hay rẽ) được tính theo **đoạn cuối** của hình dạng, nên nhánh cong vào nút theo hướng nào thì được nhận đúng hướng đó.

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

### Tối ưu nâng cao: chạy thử và hiệu chỉnh lặp (AI)
Nằm ở cuối thẻ **Tối ưu**. Nên chạy sau bước Tối ưu ở trên.

0. **Cố vấn AI (LLM) mặc định TẮT**: không gọi dịch vụ ngoài. Bấm **⚙ Cấu hình AI** để bật hoặc tắt, nhập mô hình, khoá API, máy chủ trung gian nội bộ, số nút gửi đi, số đề xuất mỗi vòng. SPSA luôn dùng được mà không cần AI hay Internet.
1. Chọn phương pháp:
   - **SPSA**: tự hiệu chỉnh offset và thời lượng xanh bằng chạy thử CTM, không cần Internet.
   - **Cố vấn AI (Claude)**: cần khoá API Anthropic và Internet.
2. Chọn số vòng, phạm vi (mọi nút hoặc chỉ các nút kém nhất) và thời lượng mỗi lần chạy thử.
3. Bấm **Chạy tối ưu lặp**. Biểu đồ cho thấy J (chỉ số mục tiêu) của từng lần thử và J tốt nhất. Có thể bấm **Dừng** bất kỳ lúc nào; hệ thống vẫn giữ nghiệm tốt nhất.
4. Phương án tốt nhất được ghi vào **Đề xuất**. Với Cố vấn AI, nhật ký hiển thị nhận định và từng đề xuất kèm lý do, ΔJ và trạng thái nhận/loại.

Chi tiết phương pháp và lộ trình nghiên cứu: `docs/AI_TOI_UU.md`.

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

### Chỉ số mạng lưới (khung phải, luôn hiển thị)
Phía trên khung phải luôn có bảng **Chỉ số mạng lưới**, dù có chọn nút / nhánh hay không. Bấm ▾ để thu gọn.

- **Khi chưa mô phỏng** (tính theo HCM, cho phương án đang xem):
  - trễ trung bình mạng và mức phục vụ LOS;
  - số nút ở mức E–F;
  - số nhánh quá tải (x ≥ 1) và gần tải (0,85–1);
  - phân bố mức phục vụ A–F của các nút;
  - tóm tắt kết quả tối ưu nếu đã chạy.
- **Khi mô phỏng** (luỹ kế từ đầu, cập nhật liên tục):
  - **Thông suốt**: % xe tới không phải dừng.
  - **Tỷ lệ dừng**: xe gặp đèn đỏ hoặc đuôi hàng chờ.
  - **Trễ TB**: tính cho mỗi xe vào mạng.
  - **Vận tốc TB**.
  - **Đang xếp hàng**: tổng số xe trong hàng chờ, kèm nhánh có hàng chờ dài nhất. Nhấp vào tên nhánh để chọn nhánh đó.
  - **Tràn ngược**: số nhánh bị hàng chờ lấp ≥ 80% chiều dài.
  - **Cân bằng xe**: đã vào / đang chạy / chờ vào / đã ra.
  - **Phân bố mức phục vụ** các nút theo trễ mô phỏng.
  - **Biểu đồ tỷ lệ dừng** theo từng phút.

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
