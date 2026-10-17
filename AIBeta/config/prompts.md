# AIBeta Studio — Prompt Templates
> **Vi tri:** config/prompts.md
> **Muc dich:** Quan ly tap trung tat ca prompt Gemini & Pollinations.ai
> **Hot-reload:** Server tu reload khi luu file — khong can restart

---

## Bien dong (runtime variables)

| Bien | Y nghia |
|------|---------|
| {{STORY_TITLE}} | Ten truyen |
| {{STORY_CONTENT}} | Noi dung truyen (da cat ngan) |
| {{CHARACTER_REF}} | Danh sach nhan vat da phan tich |
| {{GENDER}} | Gioi tinh nhan vat |
| {{APPEARANCE}} | Mo ta ngoai hinh nhan vat |

---

## 1. Phan Tich Nhan Vat (`analyze_characters`)

> **Gui cho:** Gemini AI
> **Output:** JSON array nhan vat voi appearance + imagePrompt tieng Anh
> **Token limit:** 6000 ki tu noi dung truyen

```
Ban la chuyen gia phan tich nhan vat trong van hoc.
Hay doc doan truyen sau va trich xuat TAT CA nhan vat quan trong.

TRUYEN: "{{STORY_TITLE}}"
NOI DUNG:
{{STORY_CONTENT}}

Tra ve JSON array (KHONG co markdown, chi JSON thuan):
[
  {
    "name": "Ten nhan vat (day du, ro rang)",
    "role": "Nhan vat chinh / Nhan vat phu / Phan dien / ...",
    "gender": "male / female / unknown",
    "age": "tre em / thanh nien / trung nien / lon tuoi",
    "appearance": "Detailed English: hair color, hairstyle, eye color, height, build, signature outfit, notable features",
    "personality": "Tinh cach ngan gon",
    "imagePrompt": "English portrait prompt: [gender] [age] [appearance details], [background hint], anime cinematic style, high quality portrait, detailed face, soft lighting"
  }
]

Chi tra ve JSON array, khong giai thich them.
```

---

## 2. Phan Tich Canh (`analyze_scenes`)

> **Gui cho:** Gemini AI
> **Output:** JSON array 6-10 canh voi prompt cinematic wide-shot tieng Anh
> **Muc tieu:** Anh rong khung, nhieu nhan vat, phu hop tao AI video
> **Token limit:** 8000 ki tu noi dung truyen

```
You are a professional AI art director creating visual storyboards
for an animated short film adaptation of this Vietnamese story.

STORY TITLE: "{{STORY_TITLE}}"

CHARACTER REFERENCE (keep EXACT appearance consistent in EVERY scene):
{{CHARACTER_REF}}

STORY CONTENT:
{{STORY_CONTENT}}

=====================================================
YOUR TASK: Select 6-10 most dramatic/emotional scenes.
Create WIDE CINEMATIC ESTABLISHING SHOT prompts for each.

STRICT PROMPT RULES:
1. WIDE / ESTABLISHING SHOT ONLY
   - Characters at medium or far distance inside a large environment
   - NO extreme close-ups, NO portrait crops, NO face-filling frames
   - Think: movie establishing shot, not character headshot

2. ALL CHARACTERS IN ONE FRAME
   - Every character present in the scene must appear together
   - Describe their positions: left / center-left / center / center-right / right
   - Describe their scale: small, medium (not large/dominant)

3. ENVIRONMENT IS THE HERO
   - Open with the setting: architecture, lighting, atmosphere
   - Characters exist WITHIN the environment, not in front of blank backgrounds

4. ANIME CINEMATIC STYLE
   - Reference: Makoto Shinkai (Your Name, Weathering With You)
   - Rich background detail, atmospheric lighting, emotional color palette

5. 16:9 VIDEO-READY
   - Composition must work as a widescreen video frame
   - Suitable for AI video generation tools (Kling, Runway, Pika)

PROMPT FORMULA (follow exactly):
"[Art style keyword], [detailed environment description with architecture/lighting/atmosphere],
 [Character A name] on the [position] [wearing specific outfit] [doing action],
 [Character B name] on the [position] [wearing specific outfit] [doing action],
 [emotional atmosphere/mood], [lighting description],
 wide establishing shot, cinematic depth of field, [style reference], 8K ultra detailed"

GOOD EXAMPLE OUTPUT:
"Anime cinematic style, luxurious VIP corporate lounge with soaring ceilings,
 crystal chandeliers casting warm amber light, marble floors reflecting silhouettes,
 Liang Ha My standing center-left in sharp white blazer suit with long dark hair,
 cold intelligent expression, Ha Lan on the right in soft pink silk dress
 holding a crystal champagne glass with innocent sweet smile,
 tension and jealousy in the air, warm golden evening ambient light,
 wide establishing shot, cinematic depth of field, Makoto Shinkai style, 8K ultra detailed"

Return JSON array ONLY (no markdown, no explanation):
[
  {
    "index": 1,
    "episodeTitle": "Ten canh ngan (tieng Viet, max 5 words)",
    "desc": "Mo ta ngan canh nay xay ra gi (tieng Viet, 1-2 cau)",
    "characters_in_scene": ["Ten nhan vat 1", "Ten nhan vat 2"],
    "prompt": "[Full English cinematic wide-shot prompt — min 80 words]"
  }
]
```

---

## 3. Suffix Anh Canh (`scene_suffix`)

> **Ghep vao:** Cuoi moi scene prompt truoc khi gui Pollinations.ai
> **Muc dich:** Bao dam luon ra wide-shot, khong bi crop mat

```
, wide establishing shot, cinematic 16:9 composition, rich detailed environment, anime film quality, Makoto Shinkai style, ultra detailed background, no cropped faces, full scene visible, characters small in frame
```

---

## 4. Portrait Nhan Vat Fallback (`character_portrait_fallback`)

> **Dung khi:** Nhan vat chua co imagePrompt tu Gemini
> **Output:** Anh portrait 512x768

```
{{GENDER}} character portrait, {{APPEARANCE}},
anime cinematic style, detailed expressive face, soft studio lighting,
Makoto Shinkai character design, high quality illustration,
neutral light background, professional digital art
```

---

## 5. Tips & Tham Khao

### Style Keywords

| Style | Dung cho |
|-------|---------|
| Makoto Shinkai style | Anime chat luong cao, mau sac dep |
| Studio Ghibli aesthetic | Mau am, canh thien nhien |
| manhwa webtoon style | Truyen tranh Han Quoc |
| cinematic anime illustration | Chung chung, an toan |

### Pollinations.ai Parameters

| Loai anh | Width | Height | Model |
|----------|-------|--------|-------|
| Canh (scene) | 1280 | 720 | flux-realism |
| Portrait NV | 512 | 768 | flux-realism |

### Composition Keywords

```
wide establishing shot     → toan canh rong
medium shot                → canh vua (thay nua nguoi)
long shot                  → canh xa (thay toan than)
cinematic depth of field   → nen mo, nhan vat net
panoramic composition      → bo cuc toan canh
```


---

## 6. Phan Tich Canh Theo Audio (`analyze_scenes_batch`)

> **Gui cho:** Gemini AI (moi lan 10 canh)
> **Dung boi:** /api/img/analyze-scenes — truyen duoc chia san thanh cac doan loi doc (~10s/canh), moi doan = 1 canh
> **Bien:** {{STORY_TITLE}}, {{CHARACTER_REF}}, {{PREV_CONTEXT}}, {{SEGMENTS}}, {{SEGMENT_COUNT}}

```
You are a professional AI art director creating a visual storyboard for an animated
film adaptation of a Vietnamese story. The film is narrated by audio, so every
narration segment below becomes ONE short video clip (about 10 seconds) with ONE image.

STORY TITLE: "{{STORY_TITLE}}"

CHARACTER REFERENCE (keep EXACT appearance consistent in EVERY scene):
{{CHARACTER_REF}}

CONTEXT (narration just before this batch, for continuity):
{{PREV_CONTEXT}}

NARRATION SEGMENTS (each segment = exactly ONE scene, keep the order, do NOT skip or merge any):
{{SEGMENTS}}

=====================================================
YOUR TASK: For EACH of the {{SEGMENT_COUNT}} segments, return exactly one scene that
illustrates what THAT narration segment says (the action / emotion / place at that moment).

PROMPT RULES:
1. WIDE / ESTABLISHING SHOT, environment first (architecture, lighting, atmosphere).
2. Every character mentioned in the segment appears together in one frame, with position
   (left / center / right) and the outfit from CHARACTER REFERENCE.
3. Anime cinematic style, Makoto Shinkai reference, 16:9 video-ready.
4. Consecutive scenes must look DIFFERENT: vary camera angle, time of day, lighting,
   character action and framing, while keeping location + characters consistent.
5. English prompt, 40-70 words, formula:
   "[Art style], [environment], [Character A] on the [position] [outfit] [action],
    [Character B] ..., [mood], [lighting], wide establishing shot, cinematic depth of field, 8K ultra detailed"

Return JSON array ONLY (no markdown, no explanation), one item per segment:
[
  {
    "index": <segment number from [#N]>,
    "episodeTitle": "Ten canh ngan (tieng Viet, max 5 words)",
    "desc": "Mo ta ngan canh nay (tieng Viet, 1 cau)",
    "characters_in_scene": ["Ten nhan vat 1", "Ten nhan vat 2"],
    "prompt": "[English cinematic wide-shot prompt]"
  }
]
```