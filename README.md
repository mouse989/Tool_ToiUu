# TSO · Tối ưu Tín hiệu Mạng lưới

Phần mềm **mô phỏng, mô hình hoá và tối ưu đèn tín hiệu giao thông cho mạng lưới khoảng 500 nút giao**. Phần mềm:
- nhận dữ liệu chu kỳ, pha đèn theo hướng, lưu lượng và vận tốc tại từng vị trí trên bản đồ;
- tính toán và **đề xuất phương án vận hành** cho từng khu vực: làn sóng xanh (2 chiều / 1 chiều), vùng phối hợp,
  hoặc điều khiển thích ứng theo lưu lượng (Max Pressure / xe kích hoạt);
- kiểm chứng phương án bằng mô phỏng dòng xe có hàng chờ và tràn ngược.

Đây là bản kế thừa và nâng cấp từ *Green Zone Player MVP1*. Phần đánh giá dự án cũ và các cải tiến xem tại
[`docs/DE_XUAT_CAI_TIEN.md`](docs/DE_XUAT_CAI_TIEN.md).

## Chạy nhanh
- Windows: nhấp đúp `chay_ung_dung.bat`, hoặc mở trực tiếp `index.html` bằng Chrome/Edge.
- Máy có Node: `npm start` rồi mở `http://localhost:8080`.

Lần đầu mở có sẵn **mạng mẫu 500 nút (giả lập)**: thẻ **Tối ưu** → *Tối ưu khung giờ này* → thẻ **Mô phỏng** → *Chạy đối sánh A/B*.

## Chức năng
| Nhóm | Nội dung |
|---|---|
| Mạng lưới OSM | Vẽ vùng đa giác → tải OpenStreetMap (Overpass) hoặc nhập file .osm/.json → tự dựng nút giao (gộp đường đôi), nhánh có hướng, số làn, vận tốc, đèn tín hiệu; công cụ Gắn đèn tự gán nhánh vào ↔ pha theo trục |
| Dữ liệu | Nhập CSV nút / giản đồ pha / nhánh-lưu lượng / hướng tiếp cận (có quy đổi PCU từ số đếm phân loại); nhập thẳng file Green Zone Player; vẽ, sửa nút và nhánh trên bản đồ; bảng sửa hàng loạt; kiểm tra lỗi; bù số liệu thiếu; tính vàng/đỏ ITE; nhiều khung giờ |
| Phân tích nút | Độ bão hoà v/c, trễ và LOS theo HCM, chu kỳ Webster, chu kỳ tối thiểu khả thi |
| Tối ưu | Split cân bằng bão hoà → phân vùng Louvain → quét chu kỳ vùng theo PI (TRANSYT) có ½ chu kỳ → chấm điểm khả thi sóng xanh GWS → offset MAXBAND và vận tốc khuyến nghị → leo đồi offset/split TRANSYT → kiểm chứng CTM → khuyến nghị phương án |
| Tối ưu nâng cao (AI) | Chạy thử – hiệu chỉnh lặp bằng mô phỏng CTM: SPSA (offset + xanh hàng trăm nút, không cần Internet) và cố vấn AI Claude đề xuất có lý do, mô phỏng kiểm chứng rồi mới nhận |
| Mô phỏng | CTM có hàng chờ vật lý, sóng dừng/xả, tràn ngược, khoá nút; 4 chế độ điều khiển: cố định, xe kích hoạt, Max Pressure, Max Pressure chu kỳ cố định (kiểu SCOOT) |
| Trực quan | Bản đồ nền OSM/CARTO/GIS nội bộ; tô màu v/c, LOS, trễ, lưu lượng, vùng; biểu đồ thời gian – khoảng cách kéo thả offset, có nền mật độ mô phỏng; đường cong chu kỳ; diễn biến mô phỏng |
| Báo cáo | Phiếu cài đặt tủ (CSV), báo cáo phương án (HTML in được), dự án JSON |

## Cấu trúc mã
```
index.html            giao diện
css/app.css           giao diện sáng/tối
js/util.js            hình học trắc địa, CSV, tiện ích
js/model.js           mô hình dữ liệu, ma trận rẽ Furness, kiểm tra, bù dữ liệu
js/signal.js          Webster, split, ITE, trễ HCM, LOS
js/profile.js         bộ đánh giá biểu đồ dòng chu kỳ (TRANSYT, Robertson)
js/maxband.js         tối ưu offset hành lang (mục tiêu MAXBAND)
js/zoning.js          nhận diện hành lang, GWS, phân vùng Louvain
js/ctm.js             mô phỏng CTM + điều khiển cố định/actuated/Max Pressure
js/optimizer.js       pipeline tối ưu toàn mạng + bộ luật khuyến nghị
js/osm.js             dựng mạng lưới từ OpenStreetMap (Overpass / file .osm), gán đèn & pha theo trục
js/aiopt.js           tối ưu lặp theo mô phỏng: SPSA, cố vấn LLM (Claude) trong vòng lặp
js/io.js              nhập/xuất JSON, CSV, Green Zone Player, phiếu cài đặt tủ
js/demo.js            sinh mạng mẫu giả lập
js/mapview.js         bản đồ trượt nhẹ (không phụ thuộc thư viện)
js/charts.js          biểu đồ đường, TSD
js/app.js             điều khiển giao diện
samples/              bộ CSV mẫu 12 nút
test/run-tests.js     kiểm thử động cơ (npm test)
docs/                 đề xuất cải tiến · hướng dẫn sử dụng · định dạng dữ liệu
```
Không dùng bước build hay thư viện ngoài (chỉ tải font Google nếu có mạng), nên chạy được cả trong mạng nội bộ.

## Kiểm thử
```
npm test
```
Bộ kiểm thử gồm 16 bài:
- công thức Webster, HCM, ITE;
- bảo toàn Furness;
- MAXBAND 1 và 2 chiều;
- TRANSYT;
- bảo toàn xe và tràn ngược trong CTM;
- an toàn chuyển pha của Max Pressure;
- tách cụm Louvain;
- nhập/xuất CSV khứ hồi, nhập Green Zone;
- pipeline 150 nút: đề xuất phải giảm trễ ở cả TRANSYT lẫn CTM, và chu kỳ trong vùng phải đồng nhất.

## Tài liệu
- [Báo cáo nghiên cứu & đề xuất cải tiến](docs/DE_XUAT_CAI_TIEN.md)
- [Hướng dẫn sử dụng](docs/HUONG_DAN_SU_DUNG.md)
- [Định dạng dữ liệu](docs/DINH_DANG_DU_LIEU.md)
- [Nghiên cứu AI / LLM tối ưu tín hiệu](docs/AI_TOI_UU.md)
- [Tổng quan thuật toán thế giới & tủ tín hiệu thông minh](docs/NGHIEN_CUU_THUAT_TOAN.md)
