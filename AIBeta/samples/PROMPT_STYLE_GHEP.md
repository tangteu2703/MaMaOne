# Mẫu ghép prompt theo style (test tay)

Nguồn logic: `src/imageGen/styles.js` → `applyStyle(prompt, styleId)`.
File này được sinh từ output thật của code (cập nhật sau khi sửa style).

Công thức: `<prefix>, <prompt gốc đã lọc>, <suffix>`

> [!IMPORTANT]
> Đây là prompt **tạo 1 ảnh tĩnh**. Mọi prefix đều bắt đầu bằng `Single still ...` và đã bỏ các từ gợi video/phim
> (`animation`, `animated movie`, `whiteboard animation`) để tránh model hiểu sai → ra ảnh lỗi → tốn thêm lượt gọi API.
> Chỉ copy **nội dung trong khối code**, không copy tiêu đề hay dấu ```.

Các bước lọc trong `applyStyle`:
1. Bỏ prefix/suffix cũ (kể cả phiên bản cũ) nếu prompt đã bị bọc style.
2. Cụm ngắn (≤ 80 ký tự) chứa từ khóa style (`stick figure`, `anime`, `whiteboard`, `animation`, `doodle`...) bị bỏ; nếu cụm có chủ thể dạng `... of a <chủ thể>` thì **giữ lại chủ thể**.
3. Style khác `stickman`: bỏ mọi cụm nhắc `stick figure/stickman` và `no realistic detail`.
4. Style `stickman`: `robe` → `gown`, `cape/cloak` → `simple triangle outfit`, bỏ mô tả `background` (prefix đã quy định nền trắng), bỏ cụm `every character drawn as...` (trùng prefix/suffix).

---

## 1. Prompt gốc (đầu vào)

```text
Simple stick figure drawing style, simple stick figure of a terrifying female water ghost bride, minimalist stick figure drawing style, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, 2D stickman doodle art, horror folklore aesthetic, every character drawn as a minimalist stick figure with a round head and thin black line limbs, hand-drawn doodle, clean flat pastel background, whiteboard animation look, no realistic detail
```

### Phần còn lại sau `stripStyleWords`

```text
a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, every character drawn as a minimalist stick figure with a round head and thin black line limbs, clean flat pastel background, no realistic detail
```

---

## 2. Kết quả ghép (output thật của `applyStyle`)

### `stickman` – Người que (483 ký tự)

```text
Single still stick figure drawing, 2D black line art on plain white background, a terrifying female water ghost bride, wearing a vibrant red ancient bridal gown, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, round circle head and thin stick lines for body and limbs, hand-drawn doodle, xkcd webcomic style, child drawing, no 3D, no realistic shading, no dark silhouette
```

### `anime` – Anime hoạt hình đáng yêu (475 ký tự)

```text
Single still cute anime illustration, kawaii cartoon characters with chibi proportions, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, big sparkling eyes, soft pastel colors, clean bright lineart, cheerful whimsical mood, adorable charming anime look
```

### `hd` – Ảnh HD chân thực (424 ký tự) => OK

```text
Single photorealistic photograph, cinematic still, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, ultra realistic, natural lighting, sharp focus, shallow depth of field, 8K ultra detailed, film grain
```

### `anime2d` – Hoạt hình 2D (cartoon) (412 ký tự) => OK

```text
Single still 2D cartoon illustration, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, flat colors, bold clean outlines, cel shading, vibrant palette, simple shapes, hand-drawn cartoon look
```

### `ghibli` – Ghibli màu nước (434 ký tự) => OK

```text
Single still hand-painted watercolor illustration, Studio Ghibli inspired, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, soft watercolor textures, warm natural colors, lush painted background, gentle lighting
```

### `webtoon` – Webtoon / Manhwa (426 ký tự)

```text
Single still Korean manhwa webtoon illustration, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, clean sharp line art, soft cel shading, vivid colors, dramatic composition, detailed digital illustration
```

### `pixar3d` – 3D Pixar (447 ký tự)

```text
Single still 3D rendered character illustration, Pixar-like stylized look, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, stylized 3D render, soft global illumination, expressive characters, smooth textures, vibrant colors
```

### `inkwash` – Thủy mặc cổ phong (439 ký tự)

```text
Single still traditional Chinese ink wash painting, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, sumi-e brush strokes, misty atmosphere, muted tones with subtle red accents, rice paper texture, elegant minimalism
```

### `manga` – Manga đen trắng (420 ký tự)

```text
Single black and white Japanese manga illustration, a terrifying female water ghost bride, wearing a vibrant red ancient bridal robe, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples, horror folklore aesthetic, clean flat pastel background, high contrast ink linework, screentone shading, dramatic lighting, monochrome, detailed hatching
```

> [!NOTE]
> Nền "clean flat pastel background" từ prompt gốc được giữ lại ở các style khác `stickman` (vì là nội dung cảnh).
> Nếu không muốn, hãy xóa cụm đó khỏi prompt gốc.

---

## 3. Bản chỉnh tay (nếu muốn thử riêng)

### 3a. Stickman – nền trắng

```text
Single still stick figure drawing, 2D black line art on plain white background, a terrifying female water ghost bride, wearing a vibrant red ancient bridal gown drawn as simple red shapes, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples drawn as simple wavy lines, horror folklore doodle, round circle head and thin stick lines for body and limbs, hand-drawn doodle, xkcd webcomic style, no 3D, no realistic shading, no dark silhouette
```

### 3b. Stickman – nền pastel

```text
Single still stick figure drawing, 2D black line art on clean flat pastel background, a terrifying female water ghost bride, vibrant red ancient bridal gown as flat red shapes, long wild tangled black line hair floating upward, hollow circular eyes and creepy wide smile, floating over dark ink river ripples as wavy lines, horror folklore doodle, round circle head and thin stick lines for body and limbs, hand-drawn doodle, xkcd webcomic style, no 3D, no realistic shading
```

---

## 4. Template test tay

| # | Style | Biến thể prompt | Model / seed | Kết quả (đạt / lỗi) | Ghi chú |
|---|-------|-----------------|--------------|---------------------|---------|
| 1 | stickman | output thật (mục 2) | | | |
| 2 | stickman | 3a | | | |
| 3 | stickman | 3b | | | |
| 4 | | | | | |

## 5. Lưu ý chi phí / độ dài

- Prompt ghép ~420–580 ký tự. Model như SD-Turbo chỉ đọc ~77 token đầu → phần suffix có thể bị cắt; nên để nội dung quan trọng ở đầu body.
- Test 1 style bằng tay trước khi chạy hàng loạt cảnh để tránh gọi API nhiều lần với prompt lỗi.
