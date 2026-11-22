# Lab v3: id, ret mesajı ve alışkanlık

v2'nin üç aday düzeltmesi uygulandıktan sonra iki ölçüm yapıldı.

**1. Temel koşul, bir tekrar.** Senaryolar ve personalar v1/v2 ile aynı; alışkanlık kurulu değil.
- Komut: `TODOX_LAB_RUN=2026-11-22-v3 pnpm lab:run --repeat 1`
- Sonuç: `~/todox-lab/runs/2026-11-22-v3/r1/scores.md`

**2. Alışkanlık kurulu, üç tekrar, yalnız Can ve Jonas.**
- Komut: `lab:setup --reset --habit` ardından `lab:run <persona> --habit`
- Sonuç: `~/todox-lab/runs/2026-11-22-habit/r{1,2,3}/scores.md`
- Alışkanlık, `install:mcp`'nin yazdığı dört satırdır ve kurulumun kendi fonksiyonuyla yazıldı.
- OpenCode bunu `$XDG_CONFIG_HOME/opencode/AGENTS.md`'den okur.
- Claude Code bu koşuda kullanıcı CLAUDE.md'sini okumadığı için aynı blok prompt'a eklendi. Jonas, aşağıda anlatılan yeniden ölçümde reponun kendi CLAUDE.md'sinden okudu (`a13e1e0`).

Uygulanan düzeltmeler:
- `555d242` id'nin rakamları id sayılır; `update_task` `id` kabul eder.
- `6f2c909` ret mesajı slug listesinden önce `repo_url`'yi ister.
- `b66f9b1` lab'a `--habit` bayrağı eklendi.

## Temel koşul: v1 → v2 → v3

| metrik | v1 | v2 r1 | v2 r2 | v3 | hedef |
|---|---|---|---|---|---|
| ret | 6 | 6 | 9 | **3** | ≤ 2 |
| hatırlama | 6/9 | 7/9 | 7/9 | **8/9** | ≥ 7/9 |
| ctx first | 12/15 | 12/15 | 13/15 | 13/15 | |
| handoff | 7/15 | 7/15 | 5/15 | 7/15 | |
| entry | 10 | 10 | 13 | 12 | |
| görevsiz "neden" notu | 0 | 1 | 1 | 1 | |
| Jonas kayıt | 0 | 1 | 1 | 1 | ≥ 1 |
| işaretli oturumda cevaplanan soru | 0/2 | 0/2 | 0/2 | 0/2 | 2/2 |
| todox'a dokunmayan oturum | can s1, s2 | can s1–s3 | can s1, s2 | can s1, s2 | 0 |
| maliyet | $1.53 | $1.5 | $1.6 | $1.46 | |

Retler hakkında:
- **id tahmini kaynaklı retler sıfırlandı.** v2'de 9 retin 4'ü bu desendi. v3'te Elif s2'nin ilk çağrısı `update_task {"id": 669, …}` doğrudan geçti.
- **Kalan üç ret:** hosted modda yeni checkout'un `get_context`'i (Elif s3, Ayşe s2) ve Ayşe'nin `activity_report`'u. Üçü de kasıtlı, çünkü sunucu `repo_url` olmadan bir dizini proje sayamaz.

Elif s3 bu kez slug listesinden web projesini seçmedi; mobil repo başka bir projenin briefing'iyle açılmadı. Ama `repo_url` de göndermedi, bu yüzden mobil repo hâlâ kayıtsız. Mesajın sırası yanlış birleştirmeyi önledi; kaydı agent'a yaptıramadı.

Not: tek tekrar. v2'nin iki tekrarı arasında retler 6 ile 9 arasında oynadı. v3'teki 3, bu gürültünün altında ama tek ölçüm.

## Alışkanlık: Can ve Jonas

| | temel (v1, v2 r1, v2 r2) | alışkanlık (r1, r2, r3) |
|---|---|---|
| Can: todox'a dokunan oturum | 2/9 | **7/9** |
| Can: s1 ve s2'de dokunan | 0/6 | 4/6 |
| Can: log'a yazılan | 0 | r2: soru, iki karar, iki handoff · r3: hesap geneli bir not |
| Can s3: dünkü soruyu cevapla kapatma | 0/3 | 1/3 (r2, `answers_entry_id` ile) |
| Jonas: ctx first | 6/6 (v2) | 7/9 |
| Jonas: s2/s3 hatırlama | 3/4 (v2) | 2/6 |
| Jonas s1: `get_context {}` reddi | 1 / tekrar | r2 ve r3'te 1 |

Can, yani Haiku ve OpenCode, alışkanlık olmadan üç koşuda yalnızca iki oturumda todox'a dokundu. Alışkanlıkla dokuz oturumun yedisinde dokundu ve ilk kez log'a soru, karar ve handoff yazdı. Küçük modelin sorunu sunucu talimatını okumamasıydı; kullanıcı düzeyindeki dosyadaki dört satırı ise okuyor. B6'nın kararı, yani kurulumun alışkanlığı varsayılan olarak yazması, bu koşuyla destekleniyor.

Jonas'ta alışkanlık işe yaramadı. r1'de ilk iki oturum `get_context`'i hiç çağırmadı, hatırlama da düştü. Olası iki neden:
- Claude için alışkanlık CLAUDE.md değil, prompt'a eklenmiş metin; gerçek kurulumu birebir temsil etmiyor.
- Alışkanlık kuruluyken sunucu kurulum notlarını göndermiyor; briefing 2.9 KB'tan 2.5 KB'a iniyor.

Örnek küçük ve Jonas'ın kendi gürültüsü de büyük.

### Jonas, alışkanlık CLAUDE.md'den okunarak

İlk nedeni ayıklamak için Jonas yeniden üç tekrar koşuldu: `~/todox-lab/runs/2026-11-22-habit-claudemd/r{1,2,3}`.

- Lab, Claude'u yalnızca proje ayarlarıyla koşuyor ve kullanıcı CLAUDE.md'sine ikinci bir oturum açmadan ulaşamıyor.
- Ama reponun kendi CLAUDE.md'si aynı bellek yolundan yükleniyor. Not: Claude Code `/private/tmp` altındaki bir CLAUDE.md'yi okumuyor; lab repolarında okuyor, bu ayrıca denendi.
- `--habit` dört satırı oraya yazıyor ve `.git/info/exclude` ile `git status`'tan gizliyor.

| Jonas | v2 (alışkanlık yok) | prompt'a eklenmiş | CLAUDE.md'den |
|---|---|---|---|
| ctx first | 6/6 | 7/9 | **9/9** |
| s2/s3 hatırlama | 3/4 | 2/6 | **4/6** |
| görevsiz "neden" notu | 1 / tekrar | 0 | **3** (r1: 1, r3: 2) |
| entry ve handoff | 1 kayıt | 0 | 0 |
| ret | | | 2 |

Alışkanlık gerçek yerinden okunduğunda Jonas her oturuma `get_context` ile başladı. Bitmiş işin nedenini de üç kez proje notu olarak yazdı. İlk koşudaki düşüş, alışkanlığın kendisinden değil, prompt'a eklenmesinden geliyordu.

İki ret aynı desen: Jonas bitmiş bir işin kararını görevsiz ve `cwd` ile `log_entry`'ye yazmaya çalıştı, "Invalid input at task_id" aldı ve bir çağrı sonra `add_context`'i buldu. Ret mesajı artık doğrudan bunu söylüyor (`c4c6031`): kayıt bir göreve aittir; görevsiz bitmiş iş için `add_context(kind decision/gotcha, cwd)`, sürecek iş için önce `create_task`.

Handoff 0/3: Jonas görev açmadan bitirdiği için kapatılacak görevi yok. Bu, "bitirdiğin iş için görev açma" talimatının beklenen sonucu.

## Açık kalanlar, ve nasıl kapandılar

- **`get_context {}`** — `2f11256`. Yerel modda stdio süreci, başlatıldığı dizini `cwd` olarak kullanıyor ve şema ikisinden birini zorunlu tutmuyor. `smoke:mcp` boş çağrının aynı projeye düştüğünü stdio üzerinden doğruluyor. Hosted modda boş çağrı hâlâ reddediliyor, çünkü sunucunun dizini yok. Mesaj artık slug yerine önce `cwd`'yi ve `pwd`'yi istiyor.
- **Hosted modda yeni checkout'un kaydı** — `825a0ea`. Plugin'in SessionStart hook'u kodun durduğu makinede çalışıyor. Briefing alınamadığında agent'a bu checkout'un tam `repo_url` ve `repo_root` değerlerini veriyor; ilk `get_context` kaydı bununla yapıyor. Codex'te canlı denendi: kayıtsız mobil repoda bu satır, kayıtlı repoda briefing enjekte edildi.
- **İşaretli soru oturumları temel koşulda 0/2.** Ayşe s1 seçimi sohbette bırakmaya devam ediyor. Can, alışkanlıklı r2 koşusunda s2'de soru açtı ve s3'te cevabı `answers_entry_id` ile yazarak kapattı. Senaryodaki soru-cevap döngüsü, lab'da ilk kez baştan sona işledi. Alışkanlık kurulu kullanıcıda döngü çalışıyor; kurulu olmayan Claude oturumunda sunucu talimatı tek başına yetmiyor. Bu bir ölçüm sonucu, açık bir hata değil. Kurulumun alışkanlığı varsayılan olarak yazması (B6) buna verilen cevap.
