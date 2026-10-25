# Dòng Tin — CMS báo chí với Astro và EmDash

Dòng Tin là project học tập hoàn chỉnh về cách xây một CMS báo chí bằng Astro, EmDash và Cloudflare. EmDash quản lý content model, nội dung, media và Admin; Astro chịu trách nhiệm routing và giao diện; Cloudflare D1 lưu dữ liệu và R2 lưu media.

## 0. Quy trình từ máy mới tới production

Đây là thứ tự chuẩn. Không đổi thứ tự `build → migrate → deploy` ở production.

```text
Clone project
→ npm install
→ npm run dev
→ hoàn tất setup local
→ npm run check
→ tạo D1 và R2 trên Cloudflare
→ cập nhật wrangler.jsonc
→ npm run build
→ emdash migrate --status
→ emdash migrate
→ emdash migrate --check
→ wrangler deploy
→ hoàn tất setup production
→ kiểm tra website, Admin, upload và cron
```

Các nguyên tắc quan trọng:

- Local và production là hai database hoàn toàn khác nhau. Nội dung local không tự xuất hiện trên Cloudflare.
- `binding` trong code luôn là `DB` và `MEDIA`; tên D1/R2 thật nằm trong `wrangler.jsonc`.
- `npm run build` tạo `.emdash/migrations.json`; file này là manifest dùng để migrate đúng phiên bản EmDash.
- `npm run deploy` hiện chỉ chạy `astro build && wrangler deploy`. Script này **không** gọi `emdash migrate`.
- Với production, luôn kiểm tra và áp dụng migration trước khi deploy code mới.
- Seed chỉ bootstrap database mới. Sửa `seed/seed.json` không ghi đè một database đã setup.

## 1. Kiến trúc tổng thể

```text
EmDash Admin
    ↓ tạo và biên tập nội dung
Cloudflare D1 + R2
    ↓ getEmDashCollection / getEmDashEntry
Astro server routes
    ↓ layouts + components
Website Dòng Tin
```

Ba lớp có trách nhiệm khác nhau:

| Lớp | Trách nhiệm |
| --- | --- |
| EmDash | Schema, bài viết, trang, taxonomy, menu, byline, SEO, revision và preview |
| Astro | Routing, query, HTML, component, styling và RSS |
| Cloudflare | Worker runtime, D1 database và R2 media storage |

## 2. Chức năng đã triển khai

- Trang chủ báo chí với tin nóng, bài nổi bật và tin mới.
- Danh sách bài viết có cursor pagination.
- Trang chi tiết bài với SEO, byline, ảnh, Portable Text, nguồn và tag.
- Chuyên mục `category`: Thời sự, Kinh tế, Xã hội, Đời sống, Công nghệ, Thể thao, Giải trí.
- Khu vực `region`: Việt Nam và Quốc tế.
- Chủ đề `tag`.
- Bài liên quan cùng chuyên mục.
- Search trên `articles` và `pages`.
- Trang tĩnh: Giới thiệu, Nguyên tắc biên tập và Liên hệ.
- Menu header và footer do Admin quản lý.
- RSS tại `/rss.xml`.
- Responsive layout, empty states và trang 404.
- Cache hints cho content, settings, menus và taxonomies.
- Draft, revision, preview, scheduling, search và SEO cho bài viết.

## 3. Cấu trúc thư mục

```text
.
├── astro.config.mjs
├── emdash-env.d.ts
├── public/
│   └── favicon.svg
├── seed/
│   └── seed.json
├── src/
│   ├── components/
│   │   ├── ArticleArchive.astro
│   │   ├── ArticleCard.astro
│   │   └── NewsSidebar.astro
│   ├── layouts/
│   │   └── Base.astro
│   ├── pages/
│   │   ├── articles/
│   │   │   ├── index.astro
│   │   │   └── [slug].astro
│   │   ├── category/[slug].astro
│   │   ├── region/[slug].astro
│   │   ├── tag/[slug].astro
│   │   ├── [slug].astro
│   │   ├── index.astro
│   │   ├── search.astro
│   │   ├── rss.xml.ts
│   │   └── 404.astro
│   ├── styles/theme.css
│   ├── live.config.ts
│   └── worker.ts
└── wrangler.jsonc
```

Không sửa `src/live.config.ts`. Đây là boilerplate đăng ký EmDash live content loader.

## 4. Content model

### Collection `articles`

Mỗi entry là một bài báo.

| Field | Type | Mục đích |
| --- | --- | --- |
| `title` | `string` | Tiêu đề bài |
| `excerpt` | `text` | Sapo/mô tả ngắn |
| `featured_image` | `image` | Ảnh đại diện |
| `content` | `portableText` | Nội dung chính |
| `is_breaking` | `boolean` | Hiển thị trong thanh tin nóng |
| `is_featured` | `boolean` | Ưu tiên trên trang chủ |
| `location` | `string` | Địa điểm liên quan |
| `source_name` | `string` | Tên nguồn bên ngoài |
| `source_url` | `url` | URL nguồn bên ngoài |

Các tính năng collection:

```json
[
  "drafts",
  "revisions",
  "preview",
  "scheduling",
  "search",
  "seo"
]
```

Không tạo field `published_date`: EmDash đã cung cấp `entry.data.publishedAt`.

Không tạo field `author` dạng string: EmDash đã cung cấp `byline` và `bylines`.

### Collection `pages`

Dùng cho nội dung ít thay đổi:

- Giới thiệu.
- Liên hệ.
- Nguyên tắc biên tập.

Fields: `title` và `content`.

## 5. Taxonomy

### `category`

Chuyên mục nội dung lớn, có thể mở rộng thành cây cha-con:

```text
Kinh tế
├── Tài chính
├── Doanh nghiệp
└── Bất động sản
```

Tên query phải đúng chính xác là `category`:

```ts
getTaxonomyTermsWithCacheHint("category");
```

### `region`

Phân biệt phạm vi Việt Nam và Quốc tế. Việc tách `region` khỏi `category` cho phép một bài vừa là `Kinh tế`, vừa thuộc `Quốc tế`.

### `tag`

Chủ đề cụ thể như AI, thị trường, môi trường hoặc bóng đá. Một bài có thể có nhiều tag.

### Vì sao “tin nóng” không phải taxonomy?

Tin nóng là trạng thái biên tập tạm thời, vì vậy dùng field `is_breaking`. Chuyên mục và tag mô tả bản chất nội dung; tin nóng mô tả cách tòa soạn ưu tiên bài ở thời điểm hiện tại.

## 6. Seed từ A đến Z

File `seed/seed.json` gồm:

```text
$schema      JSON schema cho editor
version      phiên bản định dạng seed
meta         mô tả template
settings     title, tagline, timezone
collections  articles và pages
taxonomies   category, region và tag
menus        primary và footer
bylines      hồ sơ tác giả/ban biên tập
sections     block Portable Text tái sử dụng
content      bài và trang mẫu
```

Khi database trống và setup chưa hoàn tất, request đầu tiên tự áp dụng **schema và cấu trúc** của seed. Nội dung mẫu (`content`, taxonomy terms và bylines) chỉ được nạp khi quản trị viên chọn tùy chọn này trong setup wizard. Sửa seed không ghi đè database đã có.

Để tái tạo sạch:

1. Dùng một D1/local state mới.
2. Hoàn thiện seed trước.
3. Chạy dev.
4. Mở `/_emdash/admin`, hoàn tất setup và chọn nạp nội dung mẫu.
5. Kiểm tra website, sau đó regenerate types nếu schema đã thay đổi.

Có thể kiểm tra seed mà không ghi database:

```bash
npm run seed:validate
```

Không xóa database đang có dữ liệu quan trọng chỉ để thử seed.

## 7. Entry và ID

Query một entry trả về:

```ts
{
  id: string,
  data: { ... },
  edit: { ... }
}
```

Hai ID khác nhau:

```ts
article.id       // slug, dùng trong URL
article.data.id  // database ULID, dùng cho API nội bộ
```

Ví dụ:

```astro
<a href={`/articles/${article.id}`}>{article.data.title}</a>
```

Với page context:

```ts
content={{
  collection: "articles",
  id: article.data.id,
  slug: article.id,
}}
```

## 8. Query và render bài viết

### Danh sách

```ts
const { entries, cacheHint, nextCursor } =
  await getEmDashCollection("articles", {
    status: "published",
    orderBy: { published_at: "desc" },
    limit: 12,
    cursor,
  });

if (Astro.cache?.enabled) {
  Astro.cache.set(cacheHint);
}
```

### Chi tiết

```ts
const { entry: article, cacheHint } =
  await getEmDashEntry("articles", slug);

if (!article) {
  return Astro.rewrite("/404");
}
```

### Portable Text

Không render rich text như string:

```astro
<PortableText value={article.data.content} />
```

### Image

Image field là object, không phải URL string:

```astro
<Image image={article.data.featured_image} />
```

## 9. Visual editing

Spread `edit` attributes lên element đang hiển thị field:

```astro
<h1 {...article.edit.title}>{article.data.title}</h1>
<p {...article.edit.excerpt}>{article.data.excerpt}</p>
<div {...article.edit.content}>
  <PortableText value={article.data.content} />
</div>
```

Khi Admin đăng nhập và xem website, các attributes này cho phép click-to-edit.

## 10. Routing Astro

Astro dùng file-based routing:

| File | URL |
| --- | --- |
| `src/pages/index.astro` | `/` |
| `src/pages/articles/index.astro` | `/articles` |
| `src/pages/articles/[slug].astro` | `/articles/:slug` |
| `src/pages/category/[slug].astro` | `/category/:slug` |
| `src/pages/region/[slug].astro` | `/region/:slug` |
| `src/pages/tag/[slug].astro` | `/tag/:slug` |
| `src/pages/[slug].astro` | `/:page-slug` |
| `src/pages/search.astro` | `/search` |
| `src/pages/rss.xml.ts` | `/rss.xml` |

CMS content phải server-rendered. Không dùng `getStaticPaths()` cho bài viết EmDash.

### URL của kết quả tìm kiếm

`LiveSearch` mặc định tạo URL theo mẫu `/{collection}/{slug}`. Collection `pages` của project lại dùng route `/{slug}`, vì vậy cả search ở header và trang `/search` phải khai báo `routeMap`:

```astro
<LiveSearch
  collections={["articles", "pages"]}
  routeMap={{ articles: "/articles/:slug", pages: "/:slug" }}
/>
```

Nếu bỏ `routeMap`, bài viết vẫn mở đúng nhưng kết quả page sẽ dẫn tới URL không tồn tại như `/pages/about`.

## 11. Menu

Seed tạo dữ liệu menu, không tự tạo HTML hoặc route. `Base.astro` đọc menu:

```ts
const result = await getMenuWithCacheHint("primary");
```

và render:

```astro
{result.data?.items.map(item => (
  <a href={item.url}>{item.label}</a>
))}
```

Nếu menu có `/articles`, file route `/articles` vẫn phải tồn tại trong `src/pages`.

## 12. SEO

Trang bài viết dùng `getSeoMeta()`:

```ts
const seo = getSeoMeta(article, {
  siteTitle,
  siteUrl: Astro.url.origin,
  path: Astro.url.pathname,
  defaultDescription: article.data.excerpt,
});
```

`Base.astro` render `<EmDashHead>` để plugin và SEO panel đóng góp metadata. Document `<title>` vẫn do layout đặt.

## 13. Cache invalidation

Mỗi content query trả `cacheHint`. Khi Astro cache được bật, luôn đăng ký hint:

```ts
if (Astro.cache?.enabled) {
  Astro.cache.set(cacheHint);
}
```

Với settings, menus và taxonomies, dùng biến thể `WithCacheHint`:

```ts
getSiteSettingsWithCacheHint();
getMenuWithCacheHint("primary");
getTaxonomyTermsWithCacheHint("category");
```

Điều này giúp việc publish hoặc sửa menu làm invalidation đúng route.

## 14. Chạy local từ đầu

### Bước 1: Chuẩn bị môi trường

Yêu cầu Node.js, npm và Git. Tại thư mục project:

```bash
npm install
npx wrangler whoami
```

`wrangler whoami` chỉ kiểm tra đăng nhập Cloudflare; local development vẫn dùng tài nguyên mô phỏng trong `.wrangler/state`.

### Bước 2: Kiểm tra seed và source

```bash
npm run seed:validate
npm run typecheck
```

Sửa lỗi schema hoặc TypeScript trước khi khởi động lần đầu.

### Bước 3: Khởi động local

```bash
npm run dev
```

Mở:

```text
Website: http://localhost:4321/
Admin:   http://localhost:4321/_emdash/admin/
```

Request đầu tiên chạy core migrations, áp dụng schema/structure của seed và sinh types. Trong setup wizard:

1. Nhập site title và tagline.
2. Nhập email và tên quản trị viên.
3. Chọn nạp sample content nếu muốn có sẵn 6 bài viết và 3 trang.
4. Đăng ký passkey local bằng Touch ID, PIN hoặc security key.

Passkey gắn với domain. Passkey tạo cho `localhost` không dùng được trên `workers.dev` hoặc custom domain.

### Bước 4: Dev bypass tùy chọn

Trong local development, EmDash cũng in một URL dev bypass trong terminal:

```text
http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin
```

URL này áp dụng seed, tạo hoặc dùng lại `dev@emdash.local`, đánh dấu setup hoàn tất và đăng nhập thẳng vào Admin. Chỉ dùng nó ở local; endpoint bị vô hiệu hóa trên production.

Nên hoàn tất setup trước khi chạy các lệnh CLI kết nối localhost. CLI có thể dùng auth dev bypass để tạo `Dev Admin`; nếu tài khoản đã tồn tại nhưng `emdash:setup_complete` chưa được ghi, setup wizard sẽ báo `Admin user already exists`. Khi đó mở URL setup dev bypass ở trên để hoàn tất trạng thái, không tiếp tục tạo thêm tài khoản.

Nếu dev server đã chạy trước khi seed mới hoàn thiện, hãy dùng một local D1 state mới hoặc áp dụng seed có chủ đích sau khi backup. Không xóa `.wrangler/state` khi chưa chắc dữ liệu local không còn cần thiết.

### Bước 5: Kiểm tra local

```bash
npm run check
```

Sau đó kiểm tra trang chủ, bài viết, taxonomy, search, RSS, upload media và publish/schedule trong Admin.

## 15. Generated types

`emdash-env.d.ts` được sinh tự động. Không chỉnh tay.

Sau khi schema thay đổi:

```bash
npx emdash types --url http://localhost:4321
```

Bạn sẽ nhận các interfaces tương ứng:

```ts
interface EmDashCollections {
  articles: Article;
  pages: Page;
}
```

## 16. Quy trình biên tập

Một quy trình đơn giản:

```text
Tạo bài draft
→ nhập title, excerpt và content
→ upload featured image
→ chọn category, region và tag
→ gán byline
→ xem preview
→ kiểm tra SEO
→ publish hoặc schedule
```

Sau khi publish, bài xuất hiện trong query public và search index.

## 17. Scheduled publishing và cron

Khi một bài được đặt lịch trong Admin, thời điểm publish được lưu trong database. Admin không cần mở liên tục.

Ở local với Cloudflare adapter, EmDash dev scheduler tự gọi mỗi 60 giây:

```text
POST /_emdash/api/dev/scheduled-tasks
```

Log `204` là bình thường: tick đã chạy thành công và không có response body. Mỗi tick xử lý plugin cron, publish nội dung đã đến hạn, đồng bộ một số trạng thái và ghi scheduler heartbeat; cleanup nặng chỉ chạy khi đến hạn.

Ở production, [src/worker.ts](src/worker.ts) đăng ký `createScheduledHandler()` và `wrangler.jsonc` cấu hình:

```jsonc
"triggers": {
  "crons": ["* * * * *"]
}
```

Cron Trigger chạy mỗi phút. Biểu thức trong Worker và Wrangler phải tương thích nếu sau này truyền `generalCron` tùy chỉnh.

## 18. D1 và R2

### Binding hiện tại

`astro.config.mjs` yêu cầu đúng hai binding:

| Binding | Vai trò |
| --- | --- |
| `DB` | Cloudflare D1 database |
| `MEDIA` | Cloudflare R2 bucket |

Repository hiện đang trỏ tới các tài nguyên production sau trong `wrangler.jsonc`:

```text
Worker: my-emdash-site
D1:     dong-tin-db
UUID:   e557dd05-363c-4df8-a305-2bd09c89cd8d
R2:     my-emdash-media
```

Không đổi `binding` thành tên database hoặc bucket. `binding` phải tiếp tục là `DB` và `MEDIA`; chỉ thay `name`, `database_name`, `database_id` và `bucket_name` khi chuyển sang tài nguyên mới.

`npm run dev` mặc định dùng D1, R2 và KV mô phỏng trong `.wrangler/state`; nội dung local không tự xuất hiện trên Cloudflare remote. `npm run deploy` mới triển khai Worker dùng D1/R2 remote trong `wrangler.jsonc`. Luôn coi development, preview và production là các môi trường dữ liệu riêng.

### Tạo tài nguyên Cloudflare mới

Đăng nhập Cloudflare:

```bash
npx wrangler whoami
```

Chỉ chạy phần này khi tạo một production environment mới. Tạo D1 ở khu vực APAC:

```bash
npx wrangler d1 create dong-tin-db --location apac
```

Tạo R2:

```bash
npx wrangler r2 bucket create my-emdash-media --location apac
```

Các lệnh trên tạo tài nguyên remote. Sau đó cập nhật `wrangler.jsonc` bằng UUID thật Wrangler trả về:

```jsonc
{
  "name": "my-emdash-site",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "dong-tin-db",
      "database_id": "UUID-D1-MOI"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA",
      "bucket_name": "my-emdash-media"
    }
  ]
}
```

Không deploy cho tới khi đã xác nhận `database_id` thuộc đúng D1 và `bucket_name` tồn tại trong đúng Cloudflare account.

Kiểm tra binding mà build sẽ sử dụng mà chưa deploy:

```bash
npm run build
npx wrangler deploy --dry-run --outdir /tmp/emdash-dry-run
```

Cuối output phải hiển thị `env.DB (dong-tin-db)` và `env.MEDIA (my-emdash-media)`.

## 19. Kiểm tra trước deploy

```bash
npm run check
```

`npm run check` lần lượt validate seed, chạy Astro typecheck và production build. Có thể chạy riêng từng lệnh khi đang debug.

Kiểm tra thủ công:

- `/` hiển thị homepage.
- `/articles` hiển thị danh sách.
- Mở ít nhất một bài chi tiết.
- Category, region và tag lọc đúng.
- Search tìm được bài.
- `/rss.xml` trả XML.
- Draft không xuất hiện public.
- Bài schedule được publish sau một scheduler tick.
- Menu sửa trong Admin cập nhật frontend.
- Ảnh render bằng component `Image`.
- Không có route dùng `getStaticPaths()`.
- `npx emdash doctor --database <đường-dẫn-database>` không báo lỗi migration hoặc scheduler wiring khi trỏ đúng database cần kiểm tra.

## 20. Đưa site lên production

### Bước 1: Xác nhận đúng Cloudflare account

```bash
npx wrangler whoami
```

Ghi lại Account ID của account sở hữu `dong-tin-db`. Không tiếp tục nếu Wrangler đang đăng nhập nhầm account.

### Bước 2: Build artifact và migration manifest

```bash
npm run check
```

Lệnh này validate seed, typecheck và build production. Sau build phải có file `.emdash/migrations.json`. File được tạo tự động và đã nằm trong `.gitignore`.

Không chỉnh `.emdash/migrations.json` bằng tay và không dùng manifest từ một lần build cũ.

### Bước 3: Cấp credential cho deployment migration

`emdash migrate` cần Account ID và Cloudflare API token có quyền **D1 Edit**. Không ghi token vào README, Git hoặc `wrangler.jsonc`.

Trên zsh/macOS, nhập token mà không lưu trực tiếp trong command history:

```bash
export CLOUDFLARE_ACCOUNT_ID="ACCOUNT_ID_CUA_BAN"
read -s "CLOUDFLARE_API_TOKEN?Cloudflare API token: "
export CLOUDFLARE_API_TOKEN
echo
```

Có thể tạo token tại Cloudflare Dashboard → My Profile → API Tokens → Create Custom Token → Account / D1 / Edit.

### Bước 4: Kiểm tra target migration

```bash
npx emdash migrate \
  --status \
  --wrangler-config wrangler.jsonc \
  --account-id "$CLOUDFLARE_ACCOUNT_ID"
```

Trước khi tiếp tục, đối chiếu đủ ba giá trị trong output:

```text
Database name: dong-tin-db
Database UUID: e557dd05-363c-4df8-a305-2bd09c89cd8d
Environment:   top-level
```

`--status` chỉ đọc; nó hiển thị `Known applied`, `Pending`, `Unknown applied`, migration lock và target fingerprint.

### Bước 5: Áp dụng core migrations

Chạy interactive migration:

```bash
npx emdash migrate \
  --wrangler-config wrangler.jsonc \
  --account-id "$CLOUDFLARE_ACCOUNT_ID"
```

Đọc lại target tại prompt rồi xác nhận. Kết quả đúng phải có:

```text
Pending: none
Unknown applied: none
```

Xác minh lần cuối:

```bash
npx emdash migrate \
  --check \
  --wrangler-config wrangler.jsonc \
  --account-id "$CLOUDFLARE_ACCOUNT_ID"
```

Không deploy nếu `--check` còn pending hoặc unknown migrations.

### Bước 6: Deploy đúng artifact

Sau khi migration thành công:

```bash
npx wrangler deploy
```

Không chạy lại `npm run deploy` ở bước này vì script đó build lại rồi deploy. Quy trình rõ ràng hơn là build một lần, dùng manifest của build đó để migrate, rồi deploy generated Worker config của chính build đó.

Production hiện tại:

```text
Website: https://my-emdash-site.hieuhero245.workers.dev/
Admin:   https://my-emdash-site.hieuhero245.workers.dev/_emdash/admin/
```

### Bước 7: Setup production lần đầu

Với D1 mới, mở Admin và hoàn tất wizard:

1. Nhập site title và tagline.
2. Nhập email và tên Admin.
3. Chọn sample content nếu cần.
4. Tạo một passkey mới cho chính hostname production.
5. Mở dashboard.

Không dùng dev bypass trên production. Passkey `localhost`, passkey của domain cũ hoặc passkey gắn với D1/user cũ không thay thế được passkey mới của tài khoản production.

### Bước 8: Kiểm tra sau deploy

```bash
curl -I https://my-emdash-site.hieuhero245.workers.dev/
npx wrangler deployments status
```

Sau đó kiểm tra thủ công:

- Trang chủ trả `200`.
- Admin đăng nhập lại được sau khi đóng tab.
- `articles` và `pages` xuất hiện trong Admin.
- Bài mẫu hoặc bài mới hiển thị public.
- Search và `/rss.xml` hoạt động.
- Upload ảnh ghi vào đúng R2.
- Bài schedule được cron publish.

`npm run deploy` vẫn tiện cho các lần deploy thông thường khi chắc chắn database đã ở đúng schema, nhưng quy trình an toàn cho release có thay đổi EmDash vẫn là `build → migrate → check → wrangler deploy`.

## 21. Thay đổi schema sau này

Seed là bootstrap cho database mới, không phải cơ chế đồng bộ liên tục.

Khi database đã hoạt động:

1. Thiết kế thay đổi.
2. Thực hiện thay đổi schema bằng Admin hoặc migration phù hợp.
3. Regenerate types.
4. Cập nhật frontend.
5. Cập nhật seed để database mới vẫn tái tạo được.
6. Typecheck và build.

Không xóa field đang có dữ liệu mà chưa backup và migration.

## 22. Troubleshooting

### `Database migrations are required`

Không chờ vô hạn. Kiểm tra ngay:

```bash
npx emdash migrate \
  --status \
  --wrangler-config wrangler.jsonc \
  --account-id "$CLOUDFLARE_ACCOUNT_ID"
```

Nếu có pending migrations nhưng không có lock, chạy migration như mục Deploy.

Nếu status báo lock đã giữ hơn một phút và không còn migration job nào đang chạy, dùng đúng lock ID mà status trả về:

```bash
npx emdash migrate \
  --take-over-lock LOCK_ID_TU_STATUS \
  --wrangler-config wrangler.jsonc \
  --account-id "$CLOUDFLARE_ACCOUNT_ID"
```

CLI chỉ tiếp quản nếu lock vẫn có đúng ID đó. Không tự `UPDATE _emdash_migrations_lock` trên remote D1 Console vì việc thả lock không đồng thời hoàn tất các migration còn lại và có thể tạo race với Worker.

Sau khi chạy xong, `Pending` và `Unknown applied` đều phải là `none`, rồi chạy lại `--check`.

### Website trả Cloudflare 404 ngay sau deploy

Kiểm tra deployment và `workers.dev` route:

```bash
npx wrangler deployments status
curl -I https://my-emdash-site.hieuhero245.workers.dev/
```

Trong Cloudflare Dashboard: Workers & Pages → `my-emdash-site` → Settings → Domains & Routes. `workers.dev` phải ở trạng thái enabled nếu dùng URL trên. File `wrangler.jsonc` không có `routes`, nên `workers_dev` mặc định được bật; có thể khai báo tường minh `"workers_dev": true` nếu muốn tránh phụ thuộc vào mặc định.

### `Passkey authentication failed`

Passkey bị ràng buộc với hostname. Passkey tạo tại `localhost:4321`, preview URL hoặc domain cũ không đăng nhập được vào production hostname mới.

Với D1 mới chưa setup, mở `/_emdash/admin/` và tạo Admin/passkey mới trong setup wizard. Không chọn passkey cũ mà browser gợi ý. Nếu setup đã hoàn tất nhưng mất toàn bộ passkey, dùng magic link từ một Admin khác; nếu không có email provider và đây là Admin duy nhất, cần thực hiện auth recovery có backup thay vì xóa tùy tiện bảng `users` hoặc `credentials`.

### `Admin user already exists`

Database có user nhưng setup chưa hoàn tất. Trong local development, mở:

```text
http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin
```

Nếu cần tài khoản/passkey thật thay vì `Dev Admin`, hãy backup rồi tạo local D1 state sạch và chạy setup wizard từ đầu.

### `Failed to get session commit token`

Project đang dùng:

```js
d1({ binding: "DB", session: "auto", coalesce: true })
```

Sessions API dùng bookmark/commit token để giữ read-your-writes consistency. Một lỗi internal đơn lẻ tự hết sau khi refresh thường là lỗi D1 hoặc local workerd tạm thời, không phải seed hay SQL hỏng. Nếu xảy ra thường xuyên, ưu tiên ổn định bằng:

```js
d1({ binding: "DB", session: "disabled", coalesce: false })
```

Cấu hình này đưa mọi query về primary D1 và bỏ read-replica sessions. Không bật `coalesce: true` khi sessions bị tắt.

### Log `POST /_emdash/api/dev/scheduled-tasks 204`

Đây là scheduler tick mỗi phút trong local development, không phải Admin polling và không phải lỗi. Xem mục Scheduled publishing và cron.

### Seed đã sửa nhưng database không đổi

Seed là baseline cho site mới, không phải migration tự đồng bộ. Với database đã setup, thay schema qua Admin hoặc migration phù hợp, regenerate types rồi cập nhật seed để môi trường mới có thể tái tạo.

## 23. Lệnh thường dùng

```bash
npm run dev
npm run seed:validate
npm run typecheck
npm run build
npm run check
npm run deploy
npx wrangler whoami
npx wrangler deployments status
npx emdash migrate --status --wrangler-config wrangler.jsonc --account-id "$CLOUDFLARE_ACCOUNT_ID"
npx emdash migrate --check --wrangler-config wrangler.jsonc --account-id "$CLOUDFLARE_ACCOUNT_ID"
npx emdash types --url http://localhost:4321
npx emdash schema list --url http://localhost:4321
npx emdash schema get articles --url http://localhost:4321
npx emdash doctor --database /path/to/local-d1.sqlite
```

Các lệnh có `--url http://localhost:4321` cần dev server đang chạy. Hãy hoàn tất setup trước để tránh tạo trạng thái admin dở dang qua auth dev bypass. `emdash doctor` mặc định kiểm tra `./data.db`, nên với Cloudflare local D1 phải truyền đúng file SQLite bên trong `.wrangler/state`; không copy nguyên đường dẫn hash giữa các máy.

## 24. Các bước học tiếp theo

Sau khi hiểu phiên bản hiện tại:

1. Thêm ảnh thật qua Media Library.
2. Tạo nhiều byline và bài nhiều tác giả.
3. Thêm category cha-con.
4. Thêm comments có moderation.
5. Thêm sitemap.
6. Thêm analytics qua plugin contribution.
7. Sau cùng mới thử homepage builder bằng `blocks`.

Mục tiêu của project là học đúng ranh giới CMS: quản lý nội dung, quy trình biên tập và phân phối bài viết; không trộn thêm ví tiền, thanh toán hoặc nghiệp vụ thương mại điện tử.

## 25. Tài liệu chính thức

- [EmDash documentation](https://docs.emdashcms.com/)
- [EmDash seed files](https://docs.emdashcms.com/themes/seed-files/)
- [EmDash Cloudflare deployment](https://docs.emdashcms.com/deployment/cloudflare/)
- [EmDash core database migrations](https://docs.emdashcms.com/deployment/core-migrations/)
- [EmDash authentication and passkeys](https://docs.emdashcms.com/guides/authentication/)
- [Astro documentation](https://docs.astro.build/)
- [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare R2 documentation](https://developers.cloudflare.com/r2/)
