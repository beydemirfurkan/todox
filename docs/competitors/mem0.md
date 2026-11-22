# mem0 ve todox

Bu belge mem0'ın kendi kaynak kodundan çıkarıldı: `mem0ai/mem0`, commit `fff8a64`, 2026-11-18. Repo o tarihte 69 bin yıldız, 8 bin fork ve 977 açık issue'ya sahipti; lisansı Apache-2.0, kendisi Y Combinator S24 şirketi.

Okunanlar:
- Python ve TypeScript bellek motoru;
- self-host sunucu ve dashboard;
- `integrations/` altındaki her agent eklentisi;
- `cli/` ve `skills/`;
- dokümanlar, OpenAPI şeması, son üç ayın changelog'u, CI.

Dokümanla kodun çeliştiği yerlerde kod esas alındı ve çelişki not edildi.

## Tek cümlede fark

mem0 bir **bellek motoru**dur. Konuşmayı bir LLM'e verir, LLM'in çıkardığı kısa "fact"leri vektör olarak saklar ve sonraki prompt'a anlam benzerliğiyle geri getirir.

todox bir **iş günlüğü**dür. Agent; kararı, çıkmaz sokağı, açık soruyu ve handoff'u kendisi yazar. Bunlar görevlere, repolara ve dosyalara bağlıdır. Sonraki oturum, bütçeli bir briefing'le kaldığı yerden devam eder.

İkisi de "agent'ın hafızası" diye anlatılıyor ama farklı soruları cevaplıyorlar:
- mem0: "bu kullanıcı/repo hakkında ne biliyoruz?"
- todox: "iş nerede kaldı, ne denendi, neden böyle karar verildi, kim yazdı?"

## Yan yana

| | mem0 | todox |
|---|---|---|
| Kaydı kim yazar | Sunucudaki LLM, konuşmadan çıkararak (`infer=True`) | Agent, bilerek (`log_entry`, `add_context`) |
| Kayıt birimi | 15–80 kelimelik düz "fact", türü yok | Türlü entry (`decision`, `dead_end`, `question`, `handoff`, `note`), görev, proje notu |
| Yapı | `user_id` / `agent_id` / `run_id` (Cloud'da `app_id`), metadata | Proje = repo, görev, durum, süre, dosya bağı, soru↔cevap |
| Geri getirme | Vektör + BM25 + entity boost, isteğe bağlı reranker | Postgres FTS + `pg_trgm`, odaklı (`focus`) ve bayt bütçeli briefing |
| Ne zaman gelir | İlk prompt'ta bir kez, en fazla 4000 karakter (Claude Code); Cursor'da hiç | Oturum başında briefing; compaction'dan sonra da (plugin) |
| Çelişki | OSS'de yok: "Memories accumulate; nothing is overwritten". Çözümü (Dream) ücretli Cloud'da | Agent `answers_entry_id` ile kapatır, `update_context` ile düzeltir; silme iz bırakır |
| Yazma maliyeti | Her `add` en az 1 LLM çağrısı + embedding'ler; BYOK'ta ~3.5–5.3$ / 1000 add | LLM çağrısı yok |
| Ekip | Repo başına tek havuz, "everyone reads and writes the same pool"; erişim denetimi yalnızca API anahtarı | Sahip/üye, sahiplik tek yerde, yabancı satır 404, silme yalnızca yazan ve sahip |
| Kim yazdı | `metadata.author = user_id` | Kişi, agent mı insan mı, model; briefing'de `by` ve `from_teammates` |
| İnsan arayüzü | Cloud dashboard; self-host dashboard'da 4 sayfa "PRO" kilitli | Web: projeler, görevler, raporlar, süreler; TR/EN |
| Self-host | Tek admin, davet yok, org/proje yok; eklentiler self-host sunucuya bağlanamıyor | Tam ürün: aynı uygulama, aynı MCP, Docker + Postgres |
| Telemetri | Varsayılan açık, PostHog'a; Cloud'da hesap e-postasıyla, "Not anonymous" | Yalnızca sayım (`tool_usage`: method, gün, iki sayı); üçüncü tarafa gitmez |
| Lisans | Apache-2.0 | MIT |

## Senin gösterdiğin klasörler ne

**`.claude-plugin`, `.codex-plugin`, `.cursor-plugin`, `.kimi-plugin`, `.agents/plugins`**

Her biri tek bir `marketplace.json` dosyası. Hepsi aynı `mem0@mem0-plugins` 0.3.3 eklentisini `integrations/` altındaki bir pakete yönlendiriyor:

| Manifest | Gösterdiği paket |
|---|---|
| `.claude-plugin` | `integrations/claude-code-plugin` |
| `.codex-plugin`, `.agents/plugins` | `integrations/codex-plugin` |
| `.cursor-plugin` | `integrations/cursor-plugin` |
| `.kimi-plugin` | `integrations/kimi-plugin` (GitHub URL'siyle) |

Asıl iş `integrations/agent-plugin-core`'da. Tek bir Python çekirdeği (hook runner, flush worker, tek tool'lu MCP sunucusu, kontrol CLI'ı, telemetri) `build.py` ile beş yerel pakete ve bir taşınabilir pakete birebir kopyalanıyor. Paketler arasındaki tek fark `_harness_id.py`.

Bu yüzden kurulum her istemcide tek komut. Örneğin:
- `claude plugin marketplace add mem0ai/mem0`
- `codex plugin marketplace add mem0ai/mem0`

Bizde yalnızca `.claude-plugin` var. Codex, Cursor ve diğerleri `install:mcp` ile MCP olarak bağlanıyor ama hook'ları yok.

**`cli`**

`@mem0/cli` (npm) ve `mem0-cli` (pip). Komutlar: `mem0 add | search | get | list | update | delete | import | entity | config | init | status | event`.

Genel amaçlı bir terminal istemcisi: belleğe terminalden yazıp okunuyor. Dikkat çeken iki şey var:
- `init --agent` bir agent'ın insansız hesap açmasını sağlıyor. Ortam değişkenlerinden Claude Code, Cursor, Codex, Cline, Aider ve Goose'u tanıyıp kendiliğinden "Agent Mode"a geçiyor; hesabı insan sonra `mem0 init --email` ile sahipleniyor.
- Spec'te olmayan bir `agent-rush` oyunu var: herkese açık bellek, "AGENTRUSH memories are PUBLIC".

Bizim `todox-mcp` CLI'ımız kurulum ve bakım içindir (`doctor`, `hook install`, `install:mcp`). Belleğe terminalden okuyup yazan bir istemcimiz yok.

## 1. Onlarda olup bizde olmayanlar

### Dağıtım ve istemciler

- **Marketplace paketleri:** Claude Code, Codex, Cursor, Kimi ve Antigravity için hook'lu eklenti var. Bunlara ek olarak taşınabilir "Agent Plugins v1" paketi var.
- **npm/pip eklentileri:** OpenCode (`@mem0/opencode-plugin`), Pi, OpenClaw, Hermes ve DeepSeek Harness için.
- **Hosted MCP:** `https://mcp.mem0.ai/mcp`, OAuth ile tarayıcıdan giriş; kurulumu `npx mcp-add`. Claude.ai'ye "custom connector" olarak eklenebiliyor.
- **Hook kapsamı:** SessionStart, UserPromptSubmit, PostToolUse(+Failure), SubagentStart/Stop, Stop, **PreCompact**, SessionEnd. Bizim plugin'de olmayanlar:
  - PreCompact: compaction'dan önce kaydetme;
  - SubagentStart: üst agent'ın gördüğü hafızayı alt agent'a geçirme.
- **Claude Code "Sidekick":** ayrı bir git worktree'de çalışan bir Sonnet alt agent'ı. Hafıza arayabiliyor, yerel commit atıyor, push etmiyor.
- **Uygulama tarafı entegrasyonlar:** 22+ çerçeve. LangChain, LangGraph, LlamaIndex, CrewAI, AutoGen, Agno, OpenAI Agents SDK, Google ADK, Mastra, Vercel AI SDK, Strands; sesli tarafta LiveKit, Pipecat, ElevenLabs; ayrıca n8n, Zapier, Dify, Flowise, Raycast ve bir Chrome eklentisi. todox yalnızca kodlama agent'larına yönelik; bir uygulamanın içine gömülecek SDK'sı yok.
- **SDK ve REST:** Python ve TS SDK'ları, public OpenAPI. Gruplar: memories, entities, events, exports, feedback, orgs/projects/members, webhooks, profiles.
- **Skills:** `npx skills add` ile kurulan altı skill. Üçü referans (`mem0`, `mem0-cli`, `mem0-vercel-ai-sdk`). Üçü bir uygulamaya mem0'ı TDD ile entegre eden boru hattı (`mem0-integrate`, `mem0-test-integration`, `mem0-oss-to-platform`).

### Bellek motoru

- **Anlamsal arama:** embedding'ler, BM25'in sigmoid'le normalize edilmesi ve entity boost tek skorda birleşiyor. Beş reranker seçeneği var: Cohere, ZeroEntropy, sentence-transformer, HuggingFace, LLM. Bizim arama kelime tabanlı.
- **Otomatik çıkarım:** agent hiçbir şey yazmasa da konuşmadan hafıza çıkıyor. Ayrı talimatlarla iki havuz oluşuyor: "proje" ve "kişisel". Kişisel havuz, her repoda geçerli tercihleri (paket yöneticisi, stil, iletişim) LLM'e çıkarttırıyor. Bizde bunun karşılığı agent'ın bilerek yazdığı hesap geneli not ve `get_developer`.
- **Sağlayıcı çeşitliliği:** 18 LLM, 11 embedder, 25 (TS'de 26) vektör deposu, 5 reranker.
- **Entity katmanı:** spaCy ile isim, tanımlayıcı ve konu çıkarılıyor, ayrı bir koleksiyonda hafızalara bağlanıyor. Eski Neo4j/Memgraph/Kuzu graf desteği 2026'da silindi; yerine bu geldi.
- **Diğer:**
  - `expiration_date`: süresi geçen hafıza aramadan düşüyor, silinmiyor;
  - multimodal: görselleri LLM'e tarif ettiriyor; Cloud'da PDF de var;
  - `custom_instructions`, `custom_categories`;
  - satır başına `history` tablosu (ADD/UPDATE/DELETE).

### Yalnızca Cloud'da olanlar

- **Dream:** arka planda birleştirme; tekrarları birleştirme, eskiyeni işaretleme, desen hafızası.
- **Memory Decay:** erişime göre sıralama eğimi.
- **Temporal Reasoning:** "geçen hafta" gibi ifadeleri tarihe bağlama.
- **Profiles:** şemaya göre kullanıcı özeti; beta.
- Webhooks, export (JSON/CSV/Pydantic), feedback, batch update/delete (1000'er), summary, event feed.
- **Organizasyon ve projeler:** `READER`/`OWNER` rolleri; SSO/SAML yalnızca satış ekibi üzerinden.
- **BYOK:** çıkarımı kendi LLM anahtarınla çalıştırma.
- **Dashboard Copilot:** ayarları öneren bir asistan.

### Kanıt ve görünürlük

- **Yayınlanmış benchmark'lar:** LoCoMo 92.5, LongMemEval 94.4, BEAM 1M 64.1 ve 10M 48.6; hepsi yaklaşık 7 bin token, p50 yaklaşık 1 sn. Bir de arXiv makalesi var (2504.19413).
- **Topluluk ölçeği:** Discord, 386 kişilik "vouch" listesi, dış PR'lar için "accepted issue" kapısı.

## 2. Bizden farklı yaptıkları

1. **Yazma işini agent'tan alıyorlar.** Claude Code eklentisi transcript'i byte offset'le okuyor. Prompt'u, son cevabı, değişen dosyaları ve başarısız komutları 5 tur, 10 mesaj, 40 bin karakter ya da 5 dk boşta kalma eşiklerinde topluyor. Ayrıca PreCompact ve SessionEnd'de topluyor. Hepsi arka plandaki bir worker'la Cloud'a gidiyor.

   Neyin kalacağına sunucudaki LLM karar veriyor. Yerel MCP'deki tek tool salt okunur `search_memories`. "remember" skill'i agent'a "bunu cevabında tekrar et ki çıkarım yakalasın" diyor. 0.2.x'te dokuz okuma/yazma tool'u vardı; 0.3'te kaldırıldı.

   todox'un kuralı tersi: otomatik yakalama `observations`'a gider, `entries`'e gidemez. Log'a yalnızca birinin "bu girsin" dediği satır girer.

2. **Hafıza düz ve yalnızca ekleniyor.** v3 motoru "ADD-only": tek LLM çağrısı, UPDATE/DELETE yok. Çakışan iki fact yan yana duruyor. LLM'in ürettiği `linked_memory_ids` alanı OSS'de hiç okunmuyor. Tekrar kontrolü yalnızca en yakın 10 hafızaya karşı birebir MD5.

   Kendi dokümanları da söylüyor: "Knowledge update remains the hardest category for an additive, ADD-only architecture". Düzeltme Cloud'daki Dream'e bırakılmış.

3. **Repo kimliği hash'le kuruluyor.** `agent_id = "{owner-repo}-{sha256(remote)[:10]}"`; remote yoksa `local-{ad}-{sha256(root)[:10]}`. Bu bizim `repoKey` fikrine yakın. Ama:
   - aynı repo için makine başına yol tutulmuyor;
   - iki kaydı birleştirme (`merge_projects`) yok;
   - remote'u olmayan bir klasör iki makinede iki ayrı proje oluyor.

4. **Geri getirme tek atış.** Oturumun ilk prompt'u (≥20 karakter) sorgu olarak kullanılıyor; `top_k=5`, en fazla 4000 karakter, 2 sn zaman aşımı. Görülen hafıza oturumda tekrar gösterilmiyor. Görev, açık soru ya da "kaldığın yer" diye bir bölüm yok.

   OpenCode eklentisi farklı: "where did we leave off" gibi cümleleri regex'le yakalayıp iki ek arama yapıyor. Handoff'a en yakın şey bu.

5. **Ekip modeli havuz.** Bir repoda çalışan herkes aynı havuza yazıp okuyor. Kişisel hafıza yalnızca arama filtresiyle ayrılıyor. "forget" komutu ortak hafızayı ancak `--include-project-memory` ile siliyor; bu "removes it for every teammate".

6. **Hosted öncelikli.** Python eklentileri yalnızca `api.mem0.ai`'nin `/v3/...` uçlarıyla konuşuyor. Self-host sunucu `/memories`, `/search` sunduğu için eklentiler ona bağlanamıyor. Self-host ürün tek admin; registration ilk kullanıcıdan sonra kapanıyor; "Categories, Webhooks, Analytics, Export" sayfaları "Start free on Cloud" kilidi.

7. **Telemetri varsayılan açık ve kimliğe bağlı.**
   - Eklentiler: "Events are linked to your Mem0 account email… Not anonymous".
   - Duraklatılmış eklenti de oturum başlangıcını gönderiyor.
   - Self-host sunucu kurulumda admin e-postasının alan adını ve operatörün yazdığı "use case" metnini gönderiyor; `.env.example` ise "a single onboarding event… No PII" diyor.
   - Node CLI ve TS platform istemcisinde kapatma yalnızca tam olarak `MEM0_TELEMETRY=false` yazınca çalışıyor. FAQ ise `False` yazmayı öneriyor.
   - Kütüphane, telemetri açıkken GitHub'dan uzak bir "notice" dosyası çekiyor ve kullanıcıları 50/50 A/B gruplarına ayırıyor.

8. **Fiyat ve dağıtım yön değiştiriyor.**
   - Starter/Growth/Pro planları yeni hesaplara kapandı.
   - Ücretsiz plan 30 gün sonra BYOK istiyor; anahtar yoksa yeni `add` hata veriyor.
   - Changelog'da Ekim–Kasım boyunca ürün tarafında neredeyse hiçbir şey yok; son platform girdisi 2026-05-13. Bu dönemde yalnızca güvenlik taramaları, fiyatlandırma ve eklenti cilası var.

## 3. Onların artıları

- **Agent'a sıfır yük.** Agent hiçbir şey yazmasa da bir şey kalıyor. Lab'daki Can, yani küçük model ve alışkanlığı kurulmamış kullanıcı vakası, mem0'da sorun olmazdı: hook'lar her şeyi topluyor. Bizim en zayıf ölçümümüz tam olarak bu.
- **Anlamsal hatırlama.** Kelimesi geçmeyen ama anlamı yakın hafıza da geliyor. Yayınlanmış benchmark'ları var ve kendi alanlarında, yani sohbet hafızasında, iddiaları güçlü.
- **Dağıtım genişliği.** On kodlama agent'ı, 22+ çerçeve, marketplace'te tek komutla kurulum, hosted MCP için OAuth. Bir geliştirici hangi araçta olursa olsun mem0 orada.
- **Genel amaçlılık.** Müşteri desteği botu, sesli asistan, kişisel asistan; kodlama dışında da kullanılıyor. Pazarı bizden çok daha geniş.
- **Ölçek ve marka.** 69 bin yıldız, YC, büyük katkıcı tabanı, çok sayıda yayınlanan paket. "Agent memory" denince akla gelen isim.
- **Sırlar gönderilmeden önce temizleniyor.** `SECRET_PATTERNS`: Authorization başlıkları, `sk-`, AWS `AKIA`, `ghp_`, `xox*`, PEM anahtarları. "Complete files and general tool output stay on your machine".
- **Kurumsal tarafa hazırlık.** Org ve proje rolleri, webhook, export, BYOK, hesabı silme ("GDPR/CCPA"), Vanta ile güvenlik taraması.

## 4. Bizim artılarımız

- **Log'a güvenilir, çünkü her satırın bir yazarı var.** mem0'da bir fact'i LLM çıkarıyor ve kimin onayladığı belli değil. todox'ta her satırı bir agent ya da insan yazdı; kim ve hangi model olduğu satırda duruyor. Otomatik gözlem ayrı bir bölümde, kendiliğinden siliniyor ve log'a ancak agent kendi sözleriyle yazarsa giriyor. Ürünün temel iddiası bu ve mem0'ın tasarımı bunun tersi.
- **Yapı: görev, durum, süre, handoff, çıkmaz sokak, soru.**
  - "Bu denendi mi?" sorusunun cevabı `dead_end`.
  - "Kim neye cevap bekliyor?" sorusunun cevabı açık `question`'lar ve `answers_entry_id`.
  - "Bu hafta ne bitti, ne kadar sürdü, hangi model yaptı?" sorusunun cevabı `activity_report`.

  mem0'da bunların hiçbiri yok. En yakın şeyler `problems_and_fixes` ve `decisions_and_constraints` kategorileri; bunlar bir etiket, akış değil.
- **Çelişki yerinde çözülüyor.** Bir karar değişince düzeltiliyor ya da cevapla kapanıyor. Silme yalnızca yazanda ve sahipte, iz bırakıyor. mem0 OSS'de çakışan fact'ler birikiyor; temizlik ücretli Dream'de.
- **Dosya bağları ve bayatlık uyarısı.** `link_files` hash'lerle bağlıyor; dosya değişince `get_file_context` ve briefing bunu söylüyor. mem0 değişen yolları kaydediyor ama dosyaya bağlı bir sorgusu yok.
- **Repo kimliği daha sağlam.** `repoKey` clone biçimlerini ve büyük/küçük harfi tek anahtara indiriyor. `project_paths` makine başına yol tutuyor. Bir şey yanlış kaydedildiyse `merge_projects` ve `delete_project` var. Uyarı veren tek sezgisel kural belgelenmiş.
- **Ekip modeli gerçek.** Sahiplik tek yerde denetleniyor, yabancı satır 404 dönüyor, silme yetkisi sınırlı ve iz bırakıyor. Briefing'de `from_teammates` bölümü var ve satırda yazarı görünüyor. mem0'da ise repo üzerinde herkes her şeyi yazıp okuyor; denetim yalnızca API anahtarı.
- **Yazmanın LLM maliyeti yok.** Bin kayıt bize 0$; mem0'da Cloud'a BYOK ile 3.5–5.3$. Konuşma içeriği hiçbir üçüncü taraf LLM'e gitmiyor.
- **Gizlilik iddiası kodla tutarlı.**
  - Ölçüm yalnızca sayım; parametre, gövde, yol ya da id saklanmıyor.
  - PostHog yok, e-posta yok.
  - Sunucu dosya sistemine dokunmuyor.

  mem0'ın dokümanı "anonymous" diyor; kodu e-posta gönderiyor.
- **Self-host tam ürün.** Aynı web uygulaması, aynı MCP (stdio ve hosted), aynı ekip özellikleri; kilitli "PRO" sayfa yok. mem0'da self-host tek admin, eklentiler ona bağlanmıyor.
- **İnsan için arayüz.** Görev sayfası, log akışı, raporlar, mobil düzen, Türkçe ve İngilizce. mem0 dashboard'u bir hafıza tablosu ve istek logu.
- **Oturum sonu sözleşmesi.** `session_status` dokunulan görevleri ve eksiklerini sayıyor. Stop hook'u handoff'u bir kez soruyor. Bunun karşılığı mem0'da yok; orada oturumun sonu yalnızca bir "flush".
- **Bütçeli, odaklı briefing.** `focus` cümlesi ilgili notları öne alıyor. Gövdeler bayt bütçesi bitene kadar taşınıyor, sonrası yalnızca başlık satırı. Dışarıda kalan her şey `log_omitted` ile sayılıyor. Lab'da ortalama briefing 2–3 KB; mem0'ın tek seferlik bloğu en fazla 4 KB.
- **Ölçüm altyapısı kendi kullanımımız için.** `bench:memory` ve lab (personalar, tekrarlar, karşılaştırma), "agent gerçekten yazıyor mu?" sorusunu ölçüyor. mem0'ın benchmark'ları sohbet hatırlamasını ölçüyor ve yalnızca Cloud'da koşuyor; `evaluation/` klasörü boş bir submodule.

## 5. Kodlarında bulunan zayıflıklar

Bunları rekabet konuşmasında kullanmadan önce yeniden doğrulayın; tarih: 2026-11-18.

- `mem0/proxy` (OpenAI uyumlu sohbet) bozuk görünüyor. `search()`'e `user_id=` veriyor, motor bunu `ValueError` ile reddediyor. Sonucu liste gibi gezmeye çalışıyor ama istemci `{"results": [...]}` dönüyor.
- `linked_memory_ids` prompt'ta isteniyor, OSS'de atılıyor. Prompt UUID istiyor, kod 0–9 arası sayı veriyor.
- `mem0/AGENTS.md` 24 LLM, 30 vektör deposu, 15 embedder ve `graphs/` diyor. Gerçek sayılar 18 / 25 / 11 ve `graphs/` yok.
- OpenClaw manifestosu "auto-recall ve auto-capture varsayılan kapalı" diyor; şema varsayılanı `true`. "Skills mode"da otomatik yakalama hiç yapılmıyor, README ise yapıldığını söylüyor.
- TS motorunda kayıt başarısız olsa da history'ye yazılıyor ve "ADD" olarak dönüyor.
- Eşzamanlı iki `add()` aynı fact'i iki kez yazabiliyor; kilit yok.
- OpenMemory (yerel MCP sunucusu) dokümandan ve repodan kaldırıldı. Yerini hosted MCP aldı.
- OpenCode eklentisi `MEM0_API_KEY`'i bulmak için `~/.zshrc`, `~/.bashrc` gibi dosyaları okuyor.
- README'deki benchmark tablosu "proprietary optimizations not available in the open-source SDK" ile koşulmuş. Migration dokümanlarında aynı ölçüm 91.6 / 93.4 olarak geçiyor.

## 6. Ne almalı, ne almamalı (öneri)

### Alınabilecekler, kabaca öncelik sırasıyla

1. **Codex plugin paketi.** `.codex-plugin`/`.agents/plugins` manifestosu ve hook'lu paket. Bizim hook'larımız zaten bağımlılıksız tek bir `.mjs`; mem0'ın yaptığı gibi tek kaynaktan birden çok pakete kopyalamak (`plugin:sync` bunun başı) Codex'e SessionStart briefing'ini ve Stop handoff'unu taşır. *Yapıldı (`46b84d5`). Cursor paketi de yazıldı, sonra kaldırıldı: hedef istemciler Claude Code, Codex ve OpenCode.*

   Lab'daki ret ve "todox'a hiç dokunmadı" sorunlarının bir kısmı hook'suz istemcilerden geliyor. Codex'te `SessionStart` var. Cursor'da hook bağlama ekleyemiyor (mem0 da aynı duvara çarpmış); Cursor'da yalnızca Stop ve kayıt tarafı işe yarar.

2. **PreCompact hook'u.** Compaction'dan önce, kaydedilmemiş görev varsa handoff'u bir kez istemek. Bugün yalnızca compaction'dan *sonra* briefing veriyoruz; arada kaybolan, compaction'ın özetlediği kısım.

3. **Gizli bilgi temizliği.** Entry, not ve görev gövdesinde bilinen token desenlerini (`sk-`, `ghp_`, `AKIA`, PEM, Authorization) yazmadan önce maskelemek ya da reddetmek. Bir agent'ın log'a bir anahtar yapıştırması bugün engellenmiyor.

4. **SubagentStart.** Alt agent'a üst oturumun briefing özetini geçirmek. Claude Code'un Agent tool'u yaygınlaştıkça, alt agent'lar briefing'siz çalışıyor.

5. **Anlamsal arama, isteğe bağlı.** `pgvector` varsa embedding'le arama, yoksa bugünkü FTS. Önce `bench:memory`'nin "search doğru şeyi buluyor mu" sorusunda kelime aramasının nerede kaçırdığını ölçmek gerekir; mem0'ın hibrit skoru (semantik eşik, BM25 sigmoid, entity boost) iyi bir şablon. Bedeli: embedding sağlayıcısı, yani bir üçüncü tarafa içerik gönderme. Bu yüzden varsayılan kapalı olmalı ve gizlilik metninde yazmalı.

6. **`pause` / `resume`.** Bir repo ya da oturum için gözlemi ve hook'ları geçici kapatmak. Hassas bir işte çalışan geliştirici için ucuz bir güven sinyali.

### Alınmaması gerekenler

- **Konuşmadan LLM ile otomatik log yazmak.** "Gözlem kayıt değildir" kuralıyla doğrudan çelişir. Log'un değeri, her satırın birinin kararı olmasında. Otomatik yakalama gerekiyorsa `observations`'a gider; orada zaten var.
- **Kimliğe bağlı, varsayılan açık telemetri.** "Ölçüm sayar, içerik taşımaz" sözümüz rekabet avantajı; mem0'ın kendi kodu bunun neden önemli olduğunu gösteriyor.
- **Düz fact modeli ve sınırsız birikme.** Kaydı türsüz yapmak, görev ve durum yapısının verdiği her şeyi götürür.
- **Agent'ın insansız hesap açması (`init --agent`).** Dağıtım için cazip. Ama todox'ta hesap bir kişinin log'u ve sahibi olmayan bir log, ürünün iddiasıyla çelişiyor.

## Konumlandırma

mem0 "agent'ın kullanıcıyı hatırlaması" pazarında; kodlama agent'ları orada bir kanal. todox "işin sürekliliği" pazarında: aynı repo üzerinde oturumlar, makineler, agent'lar ve insanlar arasında kararın, denemenin ve kaldığın yerin taşınması.

Bir geliştiricinin ikisini birlikte kullanması mümkün: mem0 tercihlerini hatırlar, todox işini. Doğrudan karşılaştırıldığımız yer kodlama agent'ı eklentisi. Orada bizim cevabımız şu: "mem0 konuşmadan ne çıkarıyorsa onu saklar; todox agent'ın neyi neden yaptığını yazdırır ve sana gösterir".

Bu cevabın inandırıcı olması için agent'ın gerçekten yazması gerekiyor. Lab v2'nin açık bıraktığı iş de bu: hatırlama 7/9, küçük model hâlâ dokunmuyor.
