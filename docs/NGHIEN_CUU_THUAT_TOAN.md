# TỔNG QUAN THUẬT TOÁN TỐI ƯU CHU KỲ – THỜI GIAN XANH CHO MẠNG LƯỚI NÚT GIAO
## và khả năng áp dụng với tủ tín hiệu thông minh tại TP.HCM

Tài liệu tổng hợp các họ thuật toán đang dùng trên thế giới, so sánh với những gì phần mềm TSO đã có, và đề xuất lộ trình áp dụng.
Tên sản phẩm thương mại chỉ nêu để tham khảo phương pháp. Tính năng cụ thể và điều kiện bản quyền phải xác minh với nhà cung cấp.

---

## 1. Bản đồ các họ thuật toán

| Cấp | Họ thuật toán | Đại diện tiêu biểu | Nguyên lý | TSO |
|---|---|---|---|---|
| Nút đơn | Công thức giải tích | Webster (1958); HCM; Akçelik (ARRB) | Chu kỳ tối thiểu hoá trễ, split theo độ bão hoà | ✅ đã có |
| Trục | Tối đa dải sóng xanh | MAXBAND, MULTIBAND (dải thay đổi theo lưu lượng từng đoạn), PASSER | Quy hoạch nguyên hỗn hợp (MILP) trên offset, vận tốc, thứ tự pha | ✅ mục tiêu MAXBAND; ⏳ MULTIBAND |
| Mạng – kế hoạch cố định | Mô hình dòng chu kỳ + tìm kiếm | TRANSYT (leo đồi, thuật giải di truyền GA ở các bản mới), SYNCHRO | Tối thiểu PI = trễ + K·dừng | ✅ TRANSYT leo đồi |
| Mạng – tối ưu toán học | CTM + MILP; tối ưu đa mục tiêu | Lo (1999), Lin & Wang (2004); NSGA-II | Tối ưu chính xác có xét hàng chờ vật lý; tập nghiệm Pareto trễ – dừng – khí thải | ⏳ đề xuất |
| Mạng – dựa trên mô phỏng | SPSA, thuật giải tiến hoá, tối ưu Bayes | Spall (1992); ứng dụng với SUMO / VISSIM | Mô phỏng làm hàm mục tiêu | ✅ SPSA |
| Thích ứng tập trung (theo chu kỳ) | Điều chỉnh dần split, offset, chu kỳ theo đầu dò | **SCOOT** (Anh), **SCATS** (Úc, phổ biến ở châu Á), UTOPIA (Ý), MOTION | Mỗi chu kỳ hoặc vài phút thay đổi nhỏ (±vài giây) theo độ bão hoà đo được | ✅ tương tự (Max Pressure chu kỳ cố định, ±4 s) |
| Thích ứng phi chu kỳ | Tối ưu kế hoạch pha ngắn hạn | OPAC, RHODES, **SURTRAC** (phân tán theo lịch cụm xe) | Dự báo dòng đến vài chục giây tới, tối ưu trình tự và thời lượng pha | ⏳ đề xuất |
| Điều khiển phản hồi | Max Pressure / Back-pressure; điều khiển tối ưu tuyến tính bậc hai (LQR) | Varaiya (2013); **TUC** (Diakaki, Papageorgiou) | Chọn pha theo chênh lệch hàng chờ; LQR điều chỉnh split theo hàng chờ | ✅ Max Pressure (2 dạng); ⏳ TUC |
| Tự tổ chức | Luật cục bộ ưu tiên đoàn xe | Lämmer & Helbing (2008) | Nút tự quyết theo hàng chờ và đoàn xe sắp tới, vẫn bảo đảm ổn định | ⏳ nghiên cứu |
| Cấp vùng | Điều tiết cửa ngõ theo đồ thị cơ bản vĩ mô (MFD) | Geroliminis & Daganzo (2008); Keyvan-Ekbatani (2012) | Giữ mật độ vùng lõi quanh mức tới hạn bằng cách hạn chế dòng vào ở biên | ⚠ đã thử, cần hiệu chỉnh (mục 4) |
| AI | Học tăng cường đa tác tử; mô hình ngôn ngữ lớn | PressLight, CoLight, MPLight; tác tử LLM | Học chính sách từ mô phỏng; LLM đề xuất có giải thích | ✅ LLM trong vòng lặp (tuỳ chọn bật/tắt); ⏳ học tăng cường |

✅ đã có trong TSO · ⏳ đề xuất bổ sung · ⚠ cần hiệu chỉnh

### Nhận xét chính
1. **Không có thuật toán "tốt nhất" cho mọi tình huống.** Thực tiễn quốc tế là kết hợp các tầng:
   - kế hoạch theo khung giờ (Time-of-Day, TOD) được tối ưu ngoại tuyến (TRANSYT/SYNCHRO/MAXBAND);
   - tủ chạy **phối hợp – xe kích hoạt** tại chỗ;
   - vùng trọng điểm dùng **thích ứng** (SCATS/SCOOT, hoặc Max Pressure trong nghiên cứu).
2. **Thích ứng chỉ tốt khi đầu dò tốt.** SCATS/SCOOT phụ thuộc đầu dò từng làn hoặc từng nhánh. Với dòng xe máy chiếm ưu thế, đầu dò vòng từ kém hiệu quả; camera AI đo mức chiếm dụng vùng dừng là hướng phù hợp hơn cho TP.HCM.
3. **Khi quá bão hoà** (giờ cao điểm lõi trung tâm), tối ưu từng nút mất tác dụng. Cần các biện pháp **cấp mạng**: chống tràn ngược, điều tiết dòng vào vùng lõi, ưu tiên thoát.

---

## 2. Tủ tín hiệu thông minh làm được gì?

"Tủ thông minh" thường là tủ chuẩn **ATC** (Advanced Transportation Controller) hoặc NEMA TS2, giao tiếp theo **NTCIP 1202** (đối tượng dữ liệu của bộ điều khiển kích hoạt). Chức năng tiêu chuẩn chạy **tại tủ**:

| Chức năng | Mô tả | Dữ liệu cần |
|---|---|---|
| Bảng kế hoạch theo khung giờ | Nhiều kế hoạch (chu kỳ, offset, split), đổi theo lịch giờ/ngày/ngày lễ | Kế hoạch từ phần mềm tối ưu (TSO xuất được) |
| Xe kích hoạt cục bộ | Xanh tối thiểu, gia hạn theo khoảng trống xe (gap), xanh tối đa; bỏ pha khi không có xe | Đầu dò vạch dừng / trước vạch dừng |
| **Phối hợp – xe kích hoạt** | Pha phối hợp giữ mốc kết thúc cố định để giữ sóng xanh; pha phụ hết xe thì kết thúc sớm, **trả thời gian thừa cho pha chính** | Đầu dò pha phụ + đồng bộ giờ (GPS/NTP) |
| Chọn kế hoạch theo lưu lượng (TRPS) | Tự chọn kế hoạch phù hợp khi lưu lượng đo vượt ngưỡng | Đầu dò hệ thống ở các điểm đại diện |
| Chuyển kế hoạch mượt | Chuyển offset qua vài chu kỳ (rút ngắn / kéo dài dần) | – |
| Thích ứng | Điều chỉnh chu kỳ / split / offset theo thời gian thực | Thường cần **máy chủ trung tâm thích ứng** (SCATS, SCOOT, UTOPIA…) hoặc mô-đun thích ứng của hãng |

**Kết luận:** các thuật toán tối ưu mạng (TRANSYT, MAXBAND, SPSA…) **không chạy trong tủ**. Chúng chạy ở phần mềm trung tâm như TSO để **sinh kế hoạch** nạp xuống tủ. Tủ thông minh thực thi kế hoạch và **tinh chỉnh tại chỗ** bằng kích hoạt hoặc thích ứng.

### Áp dụng cho Trung tâm (TP.HCM)
- **Hệ thống trung tâm OMNIA**: bản MVP ghi nguồn dữ liệu "OMNIA HCMC". Nếu đây là nền tảng SWARCO OMNIA, hãng này có mô-đun điều khiển thích ứng UTOPIA/SPOT. Cần xác minh với nhà cung cấp: bản quyền, loại tủ, đầu dò hiện có, giao thức nạp kế hoạch.
- **Làm được ngay** với tủ hiện có (kể cả tủ chỉ chạy cố định):
  - kế hoạch TOD tối ưu bằng TSO (4 khung giờ trở lên);
  - offset phối hợp vùng và sóng xanh;
  - vàng/đỏ toàn phần chuẩn hoá theo QCVN 41:2024/BGTVT.
- **Với tủ ATC có đầu dò hoặc camera AI**: bật **phối hợp – xe kích hoạt** (TSO đã mô phỏng được chế độ này), sau đó **chọn kế hoạch theo lưu lượng** dựa trên số đếm camera.
- **Thích ứng thật sự** (vùng lõi Q1/Q3): thí điểm mô-đun thích ứng của hệ thống trung tâm, hoặc logic Max Pressure chu kỳ cố định chạy ở trung tâm, gửi split mỗi chu kỳ. Điều kiện: truyền thông ổn định và đầu dò từng nhánh. TSO dùng để **mô phỏng trước** và làm chuẩn so sánh.

---

## 3. Đã bổ sung trong đợt này
1. **Chế độ "Phối hợp – xe kích hoạt"** (kịch bản mô phỏng *Đề xuất – phối hợp xe kích hoạt (tủ thông minh)*):
   - pha phối hợp là pha có lưu lượng lớn nhất, kết thúc đúng mốc cố định trong chu kỳ;
   - pha phụ kết thúc sớm khi không còn xe gần vạch dừng;
   - thời gian thừa trả cho pha chính.
   - *Lưu ý*: CTM là mô hình dòng liên tục, không có "khoảng trống" ngẫu nhiên giữa các xe, nên **đánh giá thấp** lợi ích của kích hoạt. Thử trên mạng mẫu 150 nút, chế độ này cho trễ cao hơn cố định khoảng 5%. Cần kiểm chứng bằng mô phỏng vi mô (mục 4) trước khi kết luận.
2. **Bật/tắt và cấu hình cố vấn AI (LLM)**:
   - mặc định **tắt**; khi tắt không gọi dịch vụ ngoài nào;
   - cấu hình được mô hình, khoá API, **máy chủ trung gian nội bộ**, số nút gửi đi, số đề xuất mỗi vòng;
   - SPSA vẫn chạy hoàn toàn trên máy.

## 4. Đề xuất áp dụng tiếp (theo thứ tự ưu tiên)

| # | Hạng mục | Lợi ích | Điều kiện |
|---|---|---|---|
| 1 | **Xuất kế hoạch theo cấu trúc NTCIP 1202**: bảng kế hoạch (chu kỳ, offset, split từng pha, pha phối hợp) và lịch khung giờ | Nạp tủ nhanh, ít sai sót | Biết loại tủ / định dạng của hệ thống trung tâm |
| 2 | **Xuất mạng sang SUMO** (mô phỏng vi mô mã nguồn mở, có mô hình làn phụ cho xe máy) | Kiểm chứng xe kích hoạt, Max Pressure, học tăng cường với xe riêng lẻ và dòng đến ngẫu nhiên | Cài SUMO trên máy trạm |
| 3 | **Chọn kế hoạch theo lưu lượng**: tính ngưỡng chuyển kế hoạch từ số đếm camera 15 phút | Tự đổi kế hoạch khi lưu lượng lệch khung giờ (mưa, sự kiện) | Luồng số đếm camera |
| 4 | **MULTIBAND** cho trục chính | Dải sóng xanh rộng hẹp theo lưu lượng từng đoạn; phù hợp trục dài có nhập/tách dòng | – |
| 5 | **Tối ưu đa mục tiêu NSGA-II** (trễ – dừng – khí thải CO₂ – chờ của người đi bộ) | Nhiều phương án để lãnh đạo lựa chọn | – |
| 6 | **Điều khiển chống tràn ngược / điều tiết cửa ngõ vùng lõi (MFD)** | Chống khoá mạng giờ cao điểm | Đã thử dạng đơn giản: điều tiết mọi ranh giới vùng làm **tăng** trễ (mạng chưa khoá nên hạn chế dòng chỉ gây thêm chờ). Cần: xác định vùng lõi thật sự quá bão hoà, hiệu chỉnh MFD từ dữ liệu, chỉ điều tiết ở biên ngoài vùng lõi |
| 7 | **Điều khiển dự báo (MPC) / TUC** cho vùng lõi quá bão hoà | Phân bổ xanh tối ưu theo hàng chờ dự báo | Mô hình đã hiệu chỉnh, dữ liệu thời gian thực |
| 8 | **Học tăng cường đa tác tử** trên SUMO đã hiệu chỉnh | Có thể vượt Max Pressure ở mạng phức tạp | Nhiều giờ huấn luyện; thí điểm có kiểm soát; luôn có kế hoạch cố định dự phòng |

## 5. Khuyến nghị lộ trình cho Trung tâm
1. **0–6 tháng**:
   - chuẩn hoá dữ liệu 500 nút;
   - hiệu chỉnh mô hình bằng camera, đạt GEH < 5 cho ≥ 85% nhánh;
   - kế hoạch TOD tối ưu (TSO) và phối hợp vùng;
   - thí điểm phối hợp – xe kích hoạt tại các tủ ATC có đầu dò.
2. **6–12 tháng**: chọn kế hoạch theo lưu lượng; xuất kế hoạch theo NTCIP 1202; kiểm chứng vi mô bằng SUMO.
3. **Sau 12 tháng**:
   - thí điểm thích ứng vùng lõi (mô-đun của hệ thống trung tâm, hoặc Max Pressure chu kỳ cố định);
   - nghiên cứu học tăng cường và cố vấn AI trong quy trình vận hành, luôn có mô phỏng kiểm chứng và người duyệt.

## Tài liệu tham khảo (chọn lọc)
- Webster, F.V. (1958). *Traffic Signal Settings*. Road Research Technical Paper 39.
- Little, J.D.C., Kelson, M.D., Gartner, N.H. (1981). MAXBAND. *Transportation Research Record* 795.
- Gartner, N.H. et al. (1991). MULTIBAND – a variable-bandwidth arterial progression scheme. *Transportation Research Record* 1287.
- Robertson, D.I. (1969). TRANSYT. RRL Report LR 253. · Hunt, P.B. et al. (1981). SCOOT. TRRL Report LR 1014.
- Sims, A.G., Dobinson, K.W. (1980). The Sydney Coordinated Adaptive Traffic (SCAT) system. *IEEE Trans. Vehicular Technology* 29(2).
- Lo, H.K. (1999). A novel traffic signal control formulation. *Transportation Research Part A* 33.
- Diakaki, C., Papageorgiou, M., Aboudolas, K. (2002). A multivariable regulator approach to traffic-responsive network-wide signal control. *Control Engineering Practice* 10.
- Lämmer, S., Helbing, D. (2008). Self-control of traffic lights and vehicle flows in urban road networks. *J. Stat. Mech.*
- Geroliminis, N., Daganzo, C.F. (2008). Existence of urban-scale macroscopic fundamental diagrams. *Transportation Research Part B* 42.
- Varaiya, P. (2013). Max pressure control of a network of signalized intersections. *Transportation Research Part C* 36.
- Smith, S.F. et al. (2013). SURTRAC: scalable urban traffic control. *TRB Annual Meeting*.
- Spall, J.C. (1992). SPSA. *IEEE Trans. Automatic Control* 37(3).
- Wei, H. et al. (2019). PressLight / CoLight (học tăng cường cho điều khiển đèn), *KDD / CIKM 2019*.
- NTCIP 1202 – Object Definitions for Actuated Signal Controllers (AASHTO/ITE/NEMA).
