# Prompt nhờ AI sáng tác truyện đúng format Story Video Studio

Cách dùng: copy **toàn bộ khối PROMPT** bên dưới vào Gemini / ChatGPT / Claude, điền các ô `[...]` ở phần
THÔNG TIN TRUYỆN. AI sẽ trả về **một file JSON** → lưu thành `ten-truyen.json` → kéo vào ô "Truyện" của trang StoryVideo.

> Quy ước nhanh: 1 phút video ≈ 6 đoạn text ≈ 18 ảnh. Muốn video N phút thì đặt `SỐ ĐOẠN = N × 6`.
> Mỗi file nên tối đa ~60 đoạn (~10 phút); truyện dài hơn thì chia thành nhiều tập (xem mục "Truyện dài").

---

## PROMPT (copy từ đây)

```
Bạn là nhà văn kịch bản chuyên viết truyện kể audio/video ngắn và là đạo diễn hình ảnh.
Hãy sáng tác một truyện HOÀN CHỈNH (có mở đầu, thắt nút, cao trào, kết) rồi xuất ra ĐÚNG ĐỊNH DẠNG JSON bên dưới.

═══ THÔNG TIN TRUYỆN ═══
- Tên truyện: [TÊN TRUYỆN]
- Thể loại: [vd: kinh dị / huyền bí / phong thủy / trinh thám / tiên hiệp / ngôn tình / hài ...]
- Ý tưởng / chủ đề (nếu có, không có thì tự sáng tạo): [1-3 câu, hoặc để trống]
- Nhân vật chính: [tên, tuổi, tính cách — hoặc để AI tự đặt]
- Bối cảnh: [thời gian, địa điểm — hoặc để AI tự chọn]
- Giọng văn: [vd: kịch tính, ám ảnh, u uất / hài hước / trữ tình ...]
- Ngôi kể: [ngôi thứ ba / ngôi thứ nhất]
- Độ dài: [N] phút → viết đúng [SỐ ĐOẠN = N×6] đoạn trong mảng "segments"
- Kết thúc: [mở để chờ tập sau / bi kịch / có hậu / twist bất ngờ]

═══ CÁCH VIẾT NỘI DUNG (phần "text" — sẽ được máy đọc thành giọng nói) ═══
1. Mỗi "text" dài 30–40 từ tiếng Việt (khoảng 10 giây đọc), gồm 2–3 câu ngắn, nhịp nhanh, dễ nghe.
2. Đoạn đầu tiên phải có "câu móc" gây tò mò/rùng mình ngay trong 2 câu đầu để giữ người xem.
3. Cốt truyện leo thang rõ: mở đầu (10%) → phát triển (40%) → thắt nút/đảo chiều (25%) → cao trào (15%) → kết (10%).
   Cuối vài đoạn nên có một câu treo (cliffhanger) để kéo người xem sang đoạn sau.
4. Văn kể (show, don't tell): dùng chi tiết giác quan (âm thanh, mùi, lạnh, bóng tối...), hạn chế giải thích dài dòng.
5. Hội thoại (nếu có) viết thẳng trong câu kể, ví dụ: Ông nhìn anh, khẽ nói rằng đừng bao giờ quay đầu lại.
   KHÔNG dùng dấu ngoặc kép lồng nhau, KHÔNG viết lời dẫn kiểu kịch bản (tên nhân vật: ...).
6. Vì có máy đọc giọng nói nên TUYỆT ĐỐI KHÔNG dùng: emoji, ký hiệu đặc biệt (* # _ / \ ( ) [ ] < > ~), ký hiệu
   markdown, từ viết tắt, số dạng chữ số (viết "hai mươi hai" thay vì 22, "ba mươi năm" thay vì 30 năm).
   Hạn chế dấu "..." và dấu chấm than liên tiếp.
7. Giữ tên nhân vật/địa danh nhất quán xuyên suốt. Không bịa thêm nhân vật rối rắm quá 6 người.
8. Không có đoạn nào trống, trùng lặp ý, hoặc chỉ là mô tả cảnh thuần tuý không có hành động/cảm xúc.

═══ CÁCH VIẾT PROMPT ẢNH (phần "globalPrompt" và "shots") — viết bằng TIẾNG ANH ═══
Ảnh được vẽ bằng AI (FLUX). Khung ảnh sẽ bị cắt về 16:9 nên phải bố cục đúng cách:
A. "globalPrompt": CHỈ mô tả phong cách + bối cảnh + tông màu + ánh sáng chung của cả truyện (30-50 từ).
   KHÔNG mô tả nhân vật trong globalPrompt (nếu không nhân vật sẽ xuất hiện trong mọi ảnh, kể cả cảnh không có người).
   KHÔNG ghi tên phong cách nghệ thuật như anime, Ghibli, 8K, photorealistic, masterpiece (công cụ tự ghép phong cách).
B. Mỗi đoạn text có đúng 3 "shots" (3 ảnh) theo thứ tự góc máy khác nhau:
   - shot 1: toàn cảnh / establishing (wide shot)
   - shot 2: trung cảnh (medium shot) — hành động chính
   - shot 3: cận cảnh (close-up) — chi tiết, đồ vật, ánh mắt, gương mặt tạo cảm xúc
   Ba ảnh phải KHÁC nhau rõ rệt về góc máy và đối tượng, nhưng cùng diễn tả nội dung đoạn text đó.
C. Mỗi shot dài 20–40 từ, một câu mô tả cụ thể: chủ thể + hành động + bối cảnh + ánh sáng/không khí.
   Dùng danh từ cụ thể, tránh trừu tượng ("a sense of dread" → "a pale hand reaching out of black water").
D. Bố cục: đặt chủ thể ở GIỮA khung, chừa khoảng trống phía trên và hai bên (không để đầu/chân sát mép ảnh).
E. Nhân vật nhất quán: trước khi viết, tự định nghĩa cho mỗi nhân vật chính một "thẻ nhân vật" cố định bằng tiếng Anh
   (tuổi, giới tính, quốc tịch, tóc, trang phục, đặc điểm nhận dạng; ví dụ:
   "Tran Binh, 22-year-old Vietnamese man, short black hair, brown work shirt, bronze compass on his belt").
   Mỗi shot CÓ nhân vật đó phải chép NGUYÊN VĂN thẻ này ở đầu shot. Shot không có nhân vật thì không nhắc tới.
F. Không yêu cầu có chữ trong ảnh (không ghi biển hiệu, chữ viết, logo, phụ đề). Không tên người nổi tiếng.
G. Tránh nội dung bị bộ lọc chặn: không máu me chi tiết, không bộ phận cơ thể bị cắt, không nội dung khiêu dâm, không trẻ em
   trong cảnh nguy hiểm. Với truyện kinh dị hãy gợi sợ bằng bóng tối, sương mù, ánh sáng đỏ, dấu hiệu bất thường.
H. Với nhân vật phụ hay cảnh đông người, mô tả ngắn gọn bằng trang phục và hành động; không cần thẻ chi tiết.

═══ ĐỊNH DẠNG ĐẦU RA (BẮT BUỘC) ═══
- Chỉ xuất ra DUY NHẤT một khối JSON hợp lệ. KHÔNG thêm lời dẫn, KHÔNG giải thích, KHÔNG bọc trong ```.
- JSON phải parse được: dùng dấu nháy kép " cho mọi khoá và chuỗi; không có dấu phẩy thừa ở phần tử cuối;
  không có chú thích // hay /* */; mọi dấu nháy kép bên trong chuỗi phải bỏ đi hoặc viết \" ; không xuống dòng thô bên trong chuỗi.
- Cấu trúc:

{
  "title": "Tên truyện",
  "globalPrompt": "style, setting, colour palette, lighting (English, no character descriptions, no art-style names)",
  "segments": [
    {
      "text": "Đoạn truyện tiếng Việt 30-40 từ, không ký hiệu đặc biệt.",
      "shots": [
        "Wide establishing shot: ...",
        "Medium shot: <character card>, ...",
        "Close-up: ..."
      ]
    }
  ]
}

═══ TỰ KIỂM TRA TRƯỚC KHI TRẢ LỜI ═══
- Số phần tử trong "segments" đúng bằng [SỐ ĐOẠN] đã nêu.
- Mỗi segment có đúng 3 chuỗi trong "shots"; mỗi "text" 30–40 từ.
- Không có emoji/ký hiệu lạ/số dạng chữ số trong "text".
- "globalPrompt" không chứa mô tả nhân vật hay tên phong cách nghệ thuật.
- Thẻ nhân vật được chép nguyên văn ở mọi shot có nhân vật.
- JSON hợp lệ hoàn toàn.
Nếu độ dài quá lớn không viết hết trong một lần, hãy viết liền mạch đến hết đoạn đang dở rồi dừng; tôi sẽ gõ "tiếp" để bạn viết tiếp.
```

---

## Ví dụ điền sẵn (copy được luôn)

```
- Tên truyện: Trầm Giang Mãn Môn: Nghề Vớt Xác Dưới Dòng Sông Mẹ
- Thể loại: kinh dị / phong thủy / huyền bí
- Ý tưởng: Chàng trai nối nghiệp gia tộc vớt xác trên sông Mẹ. Có ba loại xác không được vớt: xác đứng, xác mặc áo đỏ, xác quay mặt vào bờ.
  Anh phá cấm kỵ vớt một thi thể nữ uất hận và phát hiện bí mật luyện thi liên quan đến cái chết của gia tộc mình.
- Nhân vật chính: Trần Bính, 22 tuổi, điềm tĩnh, giỏi gieo quẻ phong thủy, gan lỳ nhưng giữ đúng quy tắc nghề
- Bối cảnh: làng quê ven sông vùng Bác Cổ, mờ sương, u uẩn
- Giọng văn: kịch tính, ám ảnh, miêu tả chi tiết cấm kỵ tâm linh
- Ngôi kể: ngôi thứ ba
- Độ dài: 5 phút → viết đúng 30 đoạn trong mảng "segments"
- Kết thúc: mở, chờ tập sau
```

Kết quả tham khảo: [tram-giang-man-mon.json](tram-giang-man-mon.json).

---

## Sau khi AI trả lời

1. Copy khối JSON → dán vào file `ten-truyen.json` (UTF-8).
2. Kiểm tra nhanh JSON hợp lệ: dán vào https://jsonlint.com (hoặc chạy `node -e "JSON.parse(require('fs').readFileSync('ten-truyen.json','utf8'))"`).
3. Kéo file vào ô **Truyện** trên trang StoryVideo. Nếu hiện cảnh báo thì đọc và sửa theo thông báo.
4. Tạo job, rồi mở mục **"🧾 Prompt từng ảnh"** để rà prompt; chưa ưng thì sửa file JSON và upload lại.

## Gợi ý chỉnh khi kết quả chưa ưng

| Vấn đề | Câu yêu cầu thêm gửi AI |
|---|---|
| Truyện nhạt, thiếu kịch tính | "Viết lại, tăng căng thẳng: mỗi 3 đoạn phải có một biến cố hoặc tiết lộ mới, đoạn 2-3 câu cuối mỗi nửa truyện phải là cú sốc." |
| Đoạn quá dài/ngắn | "Rút gọn mọi text về 30-40 từ, giữ nguyên số đoạn và ý chính." |
| Ảnh các đoạn giống nhau | "Viết lại shots: 3 shot của mỗi đoạn phải khác góc máy và khác chủ thể; không dùng lại cảnh của đoạn trước." |
| Nhân vật mỗi ảnh một khác | "Chép nguyên văn thẻ nhân vật ở đầu mọi shot có nhân vật." |
| JSON lỗi | "JSON lỗi ở vị trí [dán lỗi]. Xuất lại toàn bộ JSON hợp lệ, không thêm lời dẫn." |
| Ảnh bị chặn / lỗi sinh ảnh | "Viết lại shots theo hướng ẩn dụ, bỏ chi tiết máu me, thay bằng bóng tối, sương mù, ánh đỏ." |

## Truyện dài (nhiều tập)

Nếu truyện dài hơn ~10 phút, gửi AI thêm: *"Chia truyện thành [K] tập, mỗi tập [SỐ ĐOẠN] đoạn. Hôm nay chỉ viết TẬP 1.
Tập 1 kết bằng cliffhanger. Nhớ lại thẻ nhân vật và globalPrompt để tập sau dùng y hệt."*
Ở các tập sau, dán lại `globalPrompt` + các thẻ nhân vật của tập 1 vào đầu yêu cầu và nói *"viết TẬP 2"* — mỗi tập là một file JSON riêng, tạo thành một video riêng.
