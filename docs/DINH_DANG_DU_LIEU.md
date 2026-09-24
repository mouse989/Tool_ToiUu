# ĐỊNH DẠNG DỮ LIỆU NHẬP / XUẤT

Phần mềm nhận 4 loại CSV. Chọn nhiều file cùng lúc tại **Nhập ▾ → Nhập CSV**; phần mềm tự nhận dạng loại
theo tiêu đề cột và nạp theo thứ tự nút → pha → nhánh → hướng.

- Tiêu đề cột không phân biệt hoa/thường, có hay không có dấu tiếng Việt: `Mã nút`, `ma_nut`, `MA NUT` đều hợp lệ.
- Dấu phân cách `,` hoặc `;` đều được (Excel tiếng Việt thường xuất `;`). Chấp nhận số thập phân kiểu `12,5`.
- File xuất ra có BOM UTF-8 để Excel hiển thị đúng tiếng Việt.

Thư mục `samples/` có bộ file mẫu 12 nút. Có thể tải mẫu trống tại menu **Nhập ▾**.

## 1. Nút giao — `nut_giao.csv`
| Cột | Bắt buộc | Ý nghĩa |
|---|---|---|
| `ma_nut` | ✔ | Mã tủ/nút (duy nhất), ví dụ `2013-1` |
| `ten_nut` | | Tên nút, ví dụ `Võ Thị Sáu × Nam Kỳ Khởi Nghĩa` |
| `lat`, `lon` | ✔ | Toạ độ WGS84 |
| `be_rong_m` | | Bề rộng vùng giao cắt (m), dùng tính đỏ toàn phần ITE. Mặc định 20 |
| `co_den` | | 1 = có đèn, 0 = không đèn / nháy vàng |
| `dieu_khien` | | `fixed` cố định · `actuated` xe kích hoạt · `mp` Max Pressure · `cmp` Max Pressure chu kỳ cố định |

## 2. Giản đồ pha — `gian_do_pha.csv`
Mỗi dòng là một nút × một khung giờ. Thiếu cột `khung_gio` thì áp dụng cho mọi khung giờ.

| Cột | Ý nghĩa |
|---|---|
| `ma_nut` | Mã nút |
| `khung_gio` | Mã khung giờ: `am`, `mid`, `pm`, `night`, hoặc mã tự đặt. Mã chưa có sẽ tự tạo khung mới |
| `phuong_an` | `hien_trang` (mặc định) hoặc `toi_uu` / `de_xuat` |
| `offset` | Lệch pha θ (s): thời điểm bắt đầu xanh pha 1 so với mốc 0 của đồng hồ vùng |
| `xanh_k`, `vang_k`, `do_k` | Xanh, vàng, đỏ toàn phần của pha k, với k = 1…8 |
| `chu_ky` | Tuỳ chọn, chỉ để đối chiếu: nếu khác Σ(xanh + vàng + đỏ) phần mềm sẽ cảnh báo |

Chu kỳ luôn được tính bằng **tổng thời lượng các pha**, nên không thể lệch với giản đồ.

## 3. Nhánh tiếp cận & lưu lượng — `nhanh_luu_luong.csv`
Mỗi dòng là **một chiều đi** từ nút `tu_nut` đến nút `den_nut`, tức một nhánh tiếp cận của nút `den_nut`.

| Cột | Ý nghĩa |
|---|---|
| `tu_nut`, `den_nut` | Mã nút đầu, nút cuối |
| `ten_duong` | Tên đường, dùng nhận diện hành lang sóng xanh |
| `chieu_dai_m` | Chiều dài (m). Để trống thì tính theo toạ độ |
| `so_lan` | Số làn quy đổi |
| `s_pcu_h` | Suất dòng bão hoà của cả nhánh (pcu/h). Để trống thì lấy số làn × S cơ sở |
| `pha` | Số thứ tự pha tại `den_nut` cho nhánh đi, ví dụ `1` hoặc `1;3` |
| `q_<khung>` / `v_<khung>` | Lưu lượng (pcu/h) và vận tốc hành trình (km/h) theo từng khung giờ, ví dụ `q_am`, `v_am` |

**Dạng dọc (long)** cũng được chấp nhận: các cột `tu_nut, den_nut, khung_gio, q, v`, mỗi khung giờ một dòng.
Có thể thay `q` bằng số đếm phân loại `xe_may, o_to, xe_tai, xe_buyt` kèm `thoi_gian_dem_phut`; phần mềm tự quy đổi
ra pcu/h theo hệ số PCU trong tham số.

## 4. Hướng tiếp cận của nút — `huong_tiep_can.csv`
Dạng thuận tiện khi số liệu được ghi **theo nút và hướng** (Bắc/Nam/Đông/Tây…), không cần biết mã nút thượng lưu.
Phần mềm tự tìm nhánh vào nút có hướng đến khớp nhất (sai lệch ≤ 50°).

| Cột | Ý nghĩa |
|---|---|
| `ma_nut` | Nút |
| `huong` | Hướng xe **đến từ**: `Bắc`, `Nam`, `Đông`, `Tây`, `Đông Bắc`… hoặc `N`, `S`, `E`, `W`, `NE`… |
| `khung_gio` | Khung giờ. Để trống thì áp dụng cho mọi khung |
| `q_pcu_h` | Lưu lượng (pcu/h), **hoặc** các cột `xe_may, o_to, xe_tai, xe_buyt` + `thoi_gian_dem_phut` |
| `v_kmh`, `so_lan`, `pha` | Vận tốc, số làn, pha phục vụ |

## 5. Dự án JSON
**Lưu** xuất toàn bộ dự án, gồm khung giờ, tham số, nút, nhánh, giản đồ hiện trạng và đề xuất, hành lang, kết quả tối ưu.
**Mở…** đọc lại file này. Trình duyệt cũng tự lưu bản làm việc gần nhất (localStorage).

## 6. Nhập từ Green Zone Player (MVP1)
**Mở…** hoặc **Nhập ▾ → Green Zone Player** nhận trực tiếp file `index.html` của MVP1, hoặc file JSON chứa đối tượng `DATA`. Quy đổi như sau:
- Giản đồ hiện trạng lấy từ `g_old` + `ig`; giản đồ đề xuất lấy từ `g` + `ig` + `theta`.
- Khoảng chuyển tiếp `ig` tách thành vàng tối đa 3 s, phần còn lại là đỏ toàn phần.
- `q` (pcu/h) = q_MVP × `pcu_per_q` × 3600. S = `sat_pcu_s` × 3600.
- `qm = du_same_road` được đánh dấu là số đo; các giá trị khác là số ước lượng.
- 6 hành lang của MVP1 được nhập thành hành lang do người dùng khai báo.

## 7. Phiếu cài đặt tủ (xuất)
**Xuất ▾ → Phiếu cài đặt tủ**: mỗi dòng là một nút × một khung giờ, gồm vùng, phương án vận hành, C hiện trạng/đề xuất,
offset đề xuất, cờ chạy ½ chu kỳ, và xanh từng pha hiện trạng/đề xuất kèm vàng, đỏ toàn phần.
