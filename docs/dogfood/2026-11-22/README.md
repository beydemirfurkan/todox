# Dogfooding 2026-11-22: Tek kişi, tek repo, büyük modelde "devam et" çalışıyor; geliştiriciye bırakılan sorular, görevsiz kararlar ve ekip trafiği log'a ulaşmıyor

## Rakamlar

```
oturum 15 · biten 15/15 · önce get_context 12/15 · sonradan hatırlama 6/9
handoff 7/15 · cevaplanan soru 0/2 · doing'de kalan 0 · ret 6 · $1.53 · 9 dk
```

(Parser düzeltmesinden sonra yeniden puanlandı. Mert s3'ün handoff'u artık sayılıyor, handoff 6/15'ten 7/15'e çıktı. mert-L2 düzeldi.)

- **Devamlılık var, ama yalnızca bir yolda.** Hatırlamanın 6/9'u tutuyor ve tutanların hepsi aynı kişinin aynı repoda devam ettiği oturumlar: elif s2, mert s2/s3. Kaçan üçü (ayse s3, jonas s2, jonas s3) ya hiç kaydedilmemiş bir soruyu ya da hiç kaydedilmemiş bir "neden"i arıyordu. Yani hatırlamayı bozan şey okuma tarafı değil. Okunacak bir şey hiç yazılmamıştı.
- **`cevaplanan soru 0/2` bu koşunun en net sinyali.** İki persona (Ayşe, Can) açıkça "kararı ben vereceğim" dedi, iki seferde de `question` kaydı açılmadı.
- **Handoff 7/15 düşük görünüyor, ama sebebi iki personada toplanıyor.** Can'ın üç oturumunda da handoff yok, çünkü Haiku s1 ve s2'de todox'u hiç çağırmadı. Jonas'ın üç oturumunda da yok, çünkü bulunduğu her şey oturum içinde bitti ve talimat bunu "gürültü" sayıyor.
- **6 retten 3'ü aynı duvar:** hosted modda yeni bir checkout'ta ilk `get_context` reddediliyor (elif s3, ayse s1, ayse s2). Maliyet düşük: toplam $1.53, todox çağrıları oturum başına saniyenin onda biri kadar sürüyor.

**Lab notları (ürün bulgusu değil, rakamları okurken akılda tutun):**
1. mert-s3, bir sıralama hatası yüzünden yeniden koşuldu. Rollback git'i, entry'leri, event'leri ve context'leri geri aldı, ama ilk denemenin task #350 gövde düzenlemesini ve observation #189'u geri almadı. Bu yüzden mert-s3'ün briefing'i kısmen kirli (mert-L1). `scores.md`'deki "Contamination: None found" satırı yanlış.
2. Ayşe'nin `ledger-api` klonu hiç pull edilmedi, kodu ilk commit'te duruyor. Ayşe s2'nin "kod bu checkout'ta yok" tespiti ve Mert s3'ün Ayşe'nin notunu "bayat" diye işaretlemesi bu artefakttan geliyor.
3. OpenCode 2, MCP araçlarını `execute` adlı bir code-mode aracı içinden çalıştırıyor (mert s3, can s1-s3). Transcript'lerde todox çağrıları `tools.todox.*` olarak görünüyor.

## Personalar kullanmaya devam eder miydi?

- **Elif:** Henüz değil. Tek repoda "devam et" kusursuzdu, ama mobil repo todox için hiç var olmadı ve iki proje arasında karar taşınmadı.
- **Mert:** Henüz değil. HTTP ile stdio arasında briefing aynı yapıda geldi, ama Ayşe'nin notu briefing'e düşmedi ve hangi satırı hangi agent'ın, hangi modelin yazdığı görünmüyor.
- **Ayşe:** Kendi `platform-infra` projesi için evet. Ekip ve yönetici raporu için hayır: kişi/agent atfı yok, bir üye sahibin kayıtlarını silebiliyor.
- **Can:** Henüz değil. Agent'ı (Haiku) üç oturumun ikisinde todox'a hiç dokunmadı, telefonda okuyacak bir şey yoktu.
- **Jonas:** Hayır. Üç oturum sıfır bayt hafıza bıraktı. İşlerinin hepsi oturum içinde bittiği için talimata göre yazılacak bir şey yoktu.

## Temalar

1. **Yazma yolu, ürünün en değerli kayıt türlerini kaçırıyor.** Geliştiriciye bırakılan sorular (`question`), oturum içinde bitmiş işin "neden"i ve projeler arası kararlar hiçbir yere yazılmadı. Sebep yalnızca dikkatsiz model değil. Talimat "şimdi bitirdiğin bir şey için görev gürültüdür" diyor, `log_entry` ise görev olmadan yazılamıyor. Soru türü de uzun talimatın ortasında, somut bir tetik cümlesi olmadan duruyor. (B1, B5)
2. **Ekip tarafı tek yönlü.** Briefing yalnızca `handoff/dead_end/question/decision` türlerini ve görev başına tek handoff taşıyor. Bir takım arkadaşının `note`'u görünmüyor, `log_omitted: 0` da bunu gizliyor. Nota verilen cevap not sahibine ulaşmıyor, bildirimler yalnızca üyelik olaylarını kapsıyor. (B4, B11)
3. **Kim yazdı belli değil, ve yazılan geri alınabiliyor.** Web arayüzü agent'ın satırını insanın adıyla gösteriyor, modeli göstermiyor. Briefing'de yazar alanı hiç yok. Bir üye, sahibin kararlarını iz bırakmadan kalıcı olarak silebiliyor. "Log'a güvenilebilir" iddiası bu üçüne birden dayanıyor. (B2, B3, B13)
4. **İlk kurulum ve ilk çağrı, küçük modelde ve yeni checkout'ta kırılıyor.** Dört satırlık hafıza snippet'i kurulumda varsayılan olarak kapalı. "Bunu kur" notu insana değil agent'a, İngilizce gidiyor. Hosted modda yeni bir checkout'un ilk `get_context`'i reddediliyor, talimattaki "bir kez tekrar dene" kuralı ise yalnızca yazmalar için yazılmış. (B6, B7)
5. **Kapanış kontrolü bu oturumu görmüyor.** `session_status` 12 saatlik pencerede aynı kullanıcının önceki oturumunu bu oturum sayıyor, kirli ağacı bilmiyor. Observer da 60 saniyeden kısa oturumları kaçırıyor. Yani "handoff'suz biten oturum" için kurulan iki güvenlik ağı da kısa oturumlarda boş dönüyor. (B8, B10)

## Bulgular

Sıralama: etki × erişim. "Kaynak" sütunu: **ürün** = todox'ta düzeltilir; **ikisi** = model de hatalı, ama todox'un payı var. Yalnızca model kaynaklı olanlar ekte.

| id | başlık | personalar | kanıt | önem | tür | kaynak | alan | değişecek dosya |
|---|---|---|---|---|---|---|---|---|
| B1 | Geliştiriciye bırakılan sorular `question` olarak kaydedilmiyor, sonraki cevap hiçbir şeyi kapatamıyor | ayse (1, 7), can (2), elif (6), mert (9) | `scores.md` answeredQuestion 0/2; `can-s2` L18 sorular yalnızca sohbette, `can-s3` L7 "kayıt yok"; `ayse-s1` L30/L34, `ayse-s3` L27; #768 "chosen by the agent, not confirmed" + #350 `done` | blocker | quick win | ikisi | talimat / araç açıklaması | `mcp/tools.ts` `BASE` (WHILE WORKING paragrafına somut tetik: "seçenek sunup kararı geliştiriciye bırakıyorsan ya da geliştirici 'soracağım / sonra karar vereceğim' diyorsa `log_entry(kind:'question')`"); `lib/services/rpc-schemas.ts` `logEntry.kind` `.describe()` (code-mode katalogunda görünen tek yer) |
| B2 | Bir proje üyesi, sahibin ve diğer üyelerin kayıtlarını kalıcı olarak silebiliyor | ayse (5) | Kodda doğrulandı, aşağıya bkz. Arayüzde her satırda "sil" formu: `app/p/[slug]/t/[id]/page.tsx:262` | ağır (erişim) | quick win + ürün kararı (iz/tombstone) | ürün | erişim | `lib/services/ownership.ts`: yeni `canDeleteEntry`/`assertEntryDeletable` (`e.user_id = ? OR p.user_id = ?`, aksi halde `NotYours` → 404); `app/actions.ts` `deleteEntryAction`; `lib/services/rpc.ts` `deleteEntry`; `app/p/[slug]/t/[id]/page.tsx` (butonu yalnızca silebilene göster) |
| B3 | Agent'ın satırı insanın adıyla görünüyor, model gösterilmiyor; briefing'de yazar alanı yok | elif (5), mert (2), ayse (3) | `byline.ts` `authorWorthNaming` `author_name`'i varsa her zaman insan adını basıyor, `model`'i hiç kullanmıyor; briefing sorgusu yalnızca `id, task_id, kind, created_at, body` seçiyor; `ayse-s2` L11 `last_handoff`'ta yazar yok, L33'te agent Mert'in işini "Mert'e atfedilmiyor" dedi; `shots/ayse-ledger-task-350.png` | ağır | quick win (UI, briefing) + ürün kararı (`client` kolonu) | ürün | web UI / briefing | `app/p/[slug]/t/[id]/byline.ts` `byline` (`author === 'agent'` ise "Mert · claude-sonnet-5-5"); `lib/repositories/entries.ts` briefing sorgusu (`picked` CTE'si, `pageByTasksPerKind`'in kullandığı) `user_id`/`author`/`model` taşısın; `lib/services/briefing.ts` kayıt şekli. İstemci adı için `lib/db/schema.ts` `entries` + `mcp/tools.ts` (`prepare` ile `client`'ı ekle). `tool_usage`'a dokunulmaz |
| B4 | Briefing takım arkadaşının `note`'unu ve önceki handoff'ları göstermiyor; `log_omitted: 0` bunu gizliyor | mert (1), ayse (4) | `lib/services/briefing.ts:65` `BRIEFING_KINDS` `note` içermiyor, `PER_KIND.handoff = 1`; `omitted` yalnızca karar/çıkmaz/soru sayıyor; `mert-s3` L3 `entry_count:3, log_omitted:0`, #761 yok; `ayse-s2` L11 yalnızca #760, data race #758 yok | ağır | quick win (`log_omitted` doğru saysın) + ürün kararı (başkasından gelenler bölümü) | ürün | briefing | `lib/services/briefing.ts` `omitted` hesabı ve `BRIEFING_KINDS`/`PER_KIND`; `lib/repositories/entries.ts` `pageByTasksPerKind` (yeni bölüm: çağıranın son handoff'undan sonra başka bir kullanıcının yazdığı entry'ler, türü ne olursa olsun) |
| B5 | Oturum içinde biten işin ve projeler arası kararın "neden"i için yer yok; talimat bunu gürültü sayıyor | jonas (1, 2, 3), elif (2, 3), ayse (2) | `mcp/tools.ts:61-62` "a task for something you are finishing now, is noise"; `rpc-schemas.ts:363` `task_id` zorunlu; `schema.ts` `entries.task_id NOT NULL`; `jonas-s1` "I didn't log a todox task, since this was finished in the session"; `jonas-s2` `search` → `[]`; elif s1 kararı handoff'a gömdü, `/me` "0 karar"; ayse s1 güvenlik düzeltmesi yalnızca tag görevinin handoff'unda | blocker | ürün kararı (kısa vadede talimat, uzun vadede görevsiz entry) | ikisi | talimat / şema | Kısa vade: `mcp/tools.ts` `BASE` ("bitmiş iş için görev açma, ama nedenini proje notu olarak `add_context(project)` ile yaz; başka bir repoyu bağlıyorsa projesiz `add_context`"; BEFORE YOU FINISH'e bir adım). Uzun vade: `lib/db/schema.ts` `entries.task_id` null olabilsin + `lib/services/rpc-schemas.ts` `logEntry` (`task_id` yerine `project`) — `add-rpc-method` akışı |
| B6 | Küçük model todox'a hiç ulaşmıyor; dört satırlık snippet kurulumda kapalı, "bunu kur" notu insana değil agent'a gidiyor | can (1, 3, 4, 6, 7), jonas (5) | `scores.md` can s1/s2 todox çağrısı 0, ctx first ✗; `can-s2/state.json` boş; `can-s3` L4 `notes` İngilizce, son mesajda hiç geçmiyor; jonas s2 `get_context` atlandı; README:122 "nothing to install" ile `pnpm install:mcp` çelişiyor; `--write-memory` varsayılan kapalı (`docs/mcp.md:45`) | blocker | ürün kararı | ikisi | kurulum / web UI | `scripts/install-mcp/index.ts` (`--write-memory`'yi sor ya da varsayılan aç); `mcp/doctor.ts` (hafıza dosyasında snippet yoksa FAIL); `README.md` "Connect an agent"; web uyarısı için `app/page.tsx` — yalnızca hesap düzeyinde ve `tool_usage`'ın mevcut sayımlarından türetilir (yeni kolon, proje id'si eklenmez) |
| B7 | Hosted modda yeni checkout'un ilk `get_context`'i reddediliyor ve tekrar denenmiyor; "A REFUSED WRITE" kuralı okumaları kapsamıyor | elif (1), ayse (8) | 6 retten 3'ü: elif s3, ayse s1, ayse s2 (`scores.md`); `elif-s3` L8 ret mesajı tam çağrıyı veriyor, agent L16-17'de URL'yi aldı ama tekrar denemedi; mobil proje hiç kaydolmadı | ağır | quick win | ikisi | talimat | `mcp/tools.ts` `BASE`: "A REFUSED WRITE" → "A REFUSED CALL"; START paragrafı yeni checkout'ta ilk çağrıya `repo_url`'i (`git remote get-url origin`) eklemeyi söylesin |
| B8 | `session_status` bu oturumu görmüyor: önceki oturumun handoff'unu bu oturumunki sayıyor, kirli ağaçta sessiz kalıyor | jonas (2), mert (5) | `lib/services/session-status.ts` 12 saatlik pencere, kullanıcı bazlı; `jonas-s1` L25 `"yours": [], "hint": ""` 2 kirli dosyayla; `mert-s3` L42 `handoff_missing:false`, `last_activity_at` s2'ninki | ağır | büyük iş | ürün | araç / workspace | `mcp/tools.ts` `session_status` kaydı (`after` ile `Workspace`'ten kirli dosya sayısı; hosted'da `null` → "kontrol edilmedi"); `mcp/workspace.ts`. Sunucu dosya sistemine dokunmaz |
| B9 | Her briefing'de aynı kurulum notları (614-744 B), boş projede 2.9 KB'nin çoğu | mert (6), jonas (6), elif (7) | `mcp/tools.ts` `appendClientNotes` her `get_context`'te `notesFor`'u koşulsuz basıyor; `briefing.ts:642` geliştirici hint'i; `mert-s1` 744/1144 B; jonas s1 ve s3 kelimesi kelimesine aynı; teammate `.mcp.json` notu tek üyeli projede de çıkıyor | can sıkıcı | quick win | ürün | briefing | `mcp/tools.ts` `appendClientNotes`; `mcp/client-notes.ts` `notesFor` (teammate satırı yalnızca paylaşılan projede); `lib/services/briefing.ts` hint satırları. Not: B6'nın web uyarısı yapılmadan snippet notunu tamamen kaldırmayın, Can için tek yol oydu |
| B10 | Observer 60 sn'den kısa oturumları kaçırıyor ve çıkışta flush etmiyor | jonas (4) | `mcp/observer.ts:51` `THROTTLE_MS = 60_000`; `observe()` HEAD aynı ve aralık içindeyse kirli ağaca bakmadan dönüyor; `mcp/` altında `process.on`/stdin close yok; jonas s1 17 sn, 2 kirli dosya, `observations: 0` | ağır | quick win | ürün | araç (stdio) | `mcp/observer.ts` `observe` (`session_status`'ta her zaman bak); `mcp/server.ts` (stdin close / SIGTERM'de son bakış). Yazdığı yer `observations` olarak kalır |
| B11 | Nota verilen cevap not sahibine ulaşmıyor; bildirimler yalnızca üyelik olayları | mert (4), ayse (7) | `lib/constants.ts` `NOTIFICATION_KINDS` = davet/katılım/çıkarma; `task-service.ts` `assertAnswerable` yalnızca `question` (bilinçli: başka türü "cevaplanmış" yapmak onu briefing'den gizler); `shots/mert-notifications.png` | ağır | büyük iş | ürün | bildirim / ekip | `lib/constants.ts` `NOTIFICATION_KINDS`; `lib/services/notifications.ts`; `lib/services/task-service.ts` `addEntry` (başka bir üyenin açık görevine yazılan entry, ya da kendi sorusuna gelen cevap için bildirim); e-posta da istenirse `lib/services/mail-templates.ts` |
| B12 | Haftalık rapor yöneticiye gönderilemez: karar iki kez yazılıyor, kişi kırılımı yok | ayse (6) | `lib/services/report-markdown.ts` `taskLines` görev altında kararları yazıyor, "decisionsMade" bölümü tekrar yazıyor; `reports.ts` `activityReport` erişilen tüm projeleri kişiye bakmadan topluyor | ağır | quick win (tekrar) + ürün kararı (kişi filtresi) | ürün | rapor | `lib/services/report-markdown.ts` `taskLines` / karar bölümü; `lib/services/reports.ts` `activityReport` (`user_id` filtresi ve kişiye göre kırılım) |
| B13 | Görev gövdesi değişikliği event/iz bırakmıyor, ama briefing'de log'un üstünde `head` olarak duruyor | mert (3) | `lib/services/task-service.ts` `update`: status değişmezse yalnızca `updateStmt`, event yok; `mert-s3` L3 head'i sahipsiz "persistence done" (kanıt lab kirliliğinden geliyor, mekanizma gerçek) | ağır | ürün kararı | ürün | araç / veri | `lib/services/task-service.ts` `update`; `lib/repositories/events.ts` (gövde düzenleme event'i; `events` şu an yalnızca status geçişi tutuyor, şema kararı gerekir); `lib/services/briefing.ts` (`head` yanında `body_updated_at`) |
| B14 | Ana sayfa: çelişen boş durumlar ve proje satırında "nerede kaldı" yok | can (5), elif (4) | `app/page.tsx` `quiet.length === 0` → `quietEmpty` ("Her projede uçuşta bir iş var.") boş projeler varken de basılıyor; `shots/can-01-home.png`; `shots/elif-home.png` "0 uçuşta", proje "Sessiz" altında | can sıkıcı | quick win | ürün | web UI | `app/page.tsx` (`quiet` grubu boş durumu; `ProjectRow`'a son handoff başlığı) |
| B15 | Gizlilik metni mutlak `cwd`/`root_path` ve `repo_url`'nin saklandığını söylemiyor | jonas (7) | `docs/mcp.md`'de böyle bir satır yok (hook tablosu dışında); `app/privacy/page.tsx`'te path/repo geçmiyor; `shots/jonas-tidyfs.png` "bu makinede: /Users/…" | can sıkıcı | quick win | ürün | dokümantasyon | `docs/mcp.md` ("her araç çağrısı ne gönderir" tablosu); `app/privacy/page.tsx` + `lib/i18n/en.ts`/`tr.ts` |
| B16 | `list_projects` kullanıcının tek projesini "boş" diye gizliyor, liste `[]` dönüyor | jonas (9) | `lib/services/rpc.ts` `listProjects` `empty_projects_omitted`; `jonas-s3` L13 | can sıkıcı | quick win | ürün | araç | `lib/services/rpc.ts` `listProjects` (liste boş kalacaksa gizleme ya da gizlenen slug'ları ver) |
| B17 | Telefonda board kolonları ve "Ayrıntı" çipi sağdan kesik, kaydırma ipucu yok | can (8) | `shots/can-02-board.png` (Yapılıyor kolonu ve Ayrıntı çipi kesik) | can sıkıcı | quick win | ürün | web UI | `app/p/[slug]/board-columns.tsx` (`ui-conventions` skill'i) |
| B18 | `get_task` `id` kabul etmiyor, oysa `create_task`/`search` `id` döndürüyor | mert (8) | `rpc-schemas.ts:308` `getTask: { task_id }`; `mert-s3` L11 ret, L16 düzeldi | can sıkıcı | quick win | ürün | araç | `lib/services/rpc-schemas.ts` `getTask` + `rpc-schemas.test.ts` |
| B19 | Dokümandaki stdio kurulumu sabitlenmemiş `latest` tarball'ı çalıştırıyor | jonas (8) | `README.md` 283, 356, 368, 399 `releases/latest/download/todox-mcp.tgz` | can sıkıcı | quick win | ürün | dokümantasyon | `README.md` "Optional: local mode" (önce sürümlü tarball) |
| B20 | `quickCloseHint` çok oturumlu bir göreve "Done within minutes" diyor | mert (7) | `lib/services/write-hints.ts` `quickCloseHint` yalnızca süreye bakıyor; `mert-s3` L45. Lab zamanı sıkıştırdığı için tetiklendi, gerçek kullanımda nadir | düşük | quick win | ürün | araç | `lib/services/write-hints.ts` `quickCloseHint` (görevde handoff varsa basma) |

### B2 hakkında: Ayşe'nin iddiası (ayse-5) doğru

Kodda doğrulandı, canlı denenmedi:

- `lib/services/ownership.ts` `ownsEntry` yalnızca "bu kullanıcı projeye erişebiliyor mu" diye soruyor: `WHERE e.id = ? AND (p.user_id = ? OR pm.user_id IS NOT NULL)`. Entry'nin yazarına (`e.user_id`) hiç bakmıyor.
- `assertEntry` bu kontrolü sarıyor. `app/actions.ts:388` `deleteEntryAction` ve `lib/services/rpc.ts:553` `deleteEntry` yalnızca `assertEntry`'yi çağırıp `entries.remove`'a gidiyor. O da `DELETE FROM entries WHERE id = ?` ile kalıcı siliyor (`lib/repositories/entries.ts`); iz, tombstone ya da event kalmıyor.
- MCP `delete_entry` (`mcp/tools.ts:892`) aynı RPC'ye gidiyor. Yani üyenin agent'ı da silebiliyor.
- Görev sayfası silme formunu her satır için yazara bakmadan çiziyor (`app/p/[slug]/t/[id]/page.tsx:262`).

Düzeltme `ownership.ts`'e girer (kural: sahiplik tek yerde kontrol edilir). Silme yalnızca kaydı yazana ve proje sahibine açılır. Diğer herkes `NotYours` alır, yani 404 (403 değil). Silinen kayıt için iz bırakmak ayrı bir ürün kararı.

## Önerilen sonraki parti

1. **B2: üyenin silme yetkisi.** Tek kişilik bir bulgu ama erişim hatası ve "log'a güvenilir" iddiasının tam tersi. Küçük, test edilebilir (`ownership.test.ts`, `rpc-ownership.test.ts`) ve paylaşılan her projeyi etkiliyor.
2. **B1 + B5 (kısa vade) + B7: tek bir `BASE` metni değişikliği.** Üçü de `mcp/tools.ts` `BASE`'te. Dört personanın en büyük kaybı bu üç boşluktan geliyor: soru kaydı, görevsiz "neden", reddedilen ilk çağrı. Talimat zaten ~4.8 KB (Jonas). Değişiklik net sıfır uzunlukta olmalı: ekleneni bir yerden çıkarın. Etkisi bir sonraki lab koşusunda `answeredQuestion` ve elif/ayse ret sayısıyla ölçülür.
3. **B3: atıf.** Üç persona, ikisi için "kullanırdım"ı çeviren tek değişiklik. UI'da modeli göstermek ve briefing sorgusuna yazarı eklemek quick win. `client` kolonu ayrı karar.
4. **B4: `log_omitted` dürüst saysın, başkasının yazdıkları briefing'e girsin.** En azından `omitted` sayımının düzeltilmesi hemen yapılmalı: "0 gizli" diyen bir alan bir şeyi gizliyorsa, agent'ın tek uyarısı yalan söylüyor demektir.
5. **B10: observer'ın kısa oturum açığı.** Küçük bir değişiklik ve "handoff'suz biten oturum" için var olan tek güvenlik ağını kısa oturumlarda çalışır hale getiriyor. B8'in büyük işinden önce ucuz yarısı.
6. **B6'nın kurulum yarısı: `--write-memory`'yi sor, `doctor` eksik snippet'te FAIL versin.** Küçük modelli herkes Can'ın yaşadığını yaşar. Web uyarısı ölçüm kuralı yüzünden ayrıca tasarlanmalı.
7. **B9: kurulum notlarının tekrarı.** Ucuz ve her oturumun briefing'ini küçültüyor. B6 ile birlikte yapılmalı, çünkü bugün snippet notu insana giden tek yol.

Neden bu sıra: ilk ikisi güven ve yazma yolu, yani ürünün iddiası. 3-4 ekip kullanımını açıyor. 5-7 ucuz ve bir sonraki lab koşusunun rakamlarını doğrudan oynatıyor. B8, B11, B12'deki kişi filtresi ve B13 büyük iş ya da ürün kararı. Bu partiden sonra ele alınmalı.

## Düşürülen bulgular

- **mert-L1 (geri alınan s3 denemesinin kalıntısı), mert-L2 (code-mode parser):** lab bulgusu. L2 düzeldi, L1 yukarıda lab notu olarak duruyor. Ürün bulgusu değil.
- **Ayşe s2'nin "kod bu checkout'ta yok" tespiti ve Mert s3'ün Ayşe'nin notunu "bayat" bulması:** Ayşe'nin klonu pull edilmediği için oluştu. Lab artefaktı.
- **ayse-8'in "project ile çözülen çağrı cwd'yi `project_paths`'e eklemiyor" kısmı:** transcript'te agent `cwd` göndermeden `project` ile devam etti, yani kodun cwd'yi ekleyip eklemeyeceği bu koşuda test edilmedi. Ret kısmı B7'de duruyor.
- **ayse-2'nin "Türkçe 'veritabanı internete açık' araması 0 sonuç" kısmı:** arama dili davranışını doğrulamadım. Tek ekran görüntüsüne dayanıyor. Kaydın hiç yazılmaması kısmı B5'te duruyor.
- **ayse-6'nın "dil karışık" maddesi:** başlıklar arayüz dilinde, gövdeler agent'ın yazdığı dilde. Bu bir hata değil, entry gövdesi çevrilmez.
- **mert-1'deki "prompt'ta yazmasaydım görmeyecekti":** karşı-olgusal, doğrulanamaz. Bulgunun kendisi (B4) kodla doğrulandı.
- **can-7'deki OpenCode v1/v2 belirsizliği:** `docs/mcp.md:81` `--opencode-layout v1` bayrağını anlatıyor. Kısmen karşılanmış. Kalan kısım B6'nın README maddesine dahil.
- **elif-8, Jonas'ın ek yük ölçümleri:** olumlu gözlem. Bulgu değil, korunacak bir özellik.

## Ek: yalnızca model kaynaklı sorunlar

Bunlar burada düzeltilmez. Talimat açıktı, agent uymadı.

- **can s1/s3:** Haiku'nun teknik açıklaması yanlış ("`1.299` olarak okur"; s3 Türkçe kolon dedi, başlık İngilizce kaldı).
- **jonas s2:** istenen iki satırlık hatırlatma yalnızca thinking bloğunda kaldı, kullanıcıya hiç gitmedi.
- **ayse s1:** `get_context` başarılı olmadan dosyayı düzenledi (L21-23, L25).
- **ayse s3, elif s1/s2:** iş yapıldığı halde görev hiç `doing` olmadı; ayse s3 `session_status`'u da çağırmadı (ayse-9, elif-4'ün model yarısı).
- **can s3:** `get_context`'ten sonra hiçbir yazma yok (karar, handoff, `session_status`, proje özeti). Sonraki adım listesi önerisi B6/B9 kapsamında düşünülebilir, ama asıl sebep model.
- **mert s3:** "not confirmed" dediği para semantiği kararlarıyla görevi `done` yaptı (mert-9). Soru kaydı kısmı B1'e taşındı.
- **elif s3:** ret mesajı hazır çağrıyı verdiği ve agent remote URL'yi elinde tuttuğu halde tekrar denemedi. Talimat kısmı B7'ye taşındı.
- **ayse s1:** güvenlik düzeltmesi için ayrı karar ya da `link_files` yazmadı. Ürün payı B5'te.
