# Lab v2: aynı senaryolar, düzeltmelerden sonra, iki tekrar

Senaryolar, personalar ve modeller v1 (`docs/dogfood/2026-11-22/`) ile aynı. Değişen tek şey bu partideki commit'ler: #815–#821'in düzeltmeleri.

Koşu komutu: `TODOX_LAB_RUN=2026-11-22-v2 pnpm lab:run --repeat 2`. Her tekrar `lab:setup --reset` ile sıfırdan başladı.

Skor dosyaları:
- `~/todox-lab/runs/2026-11-22-v2/scores.md`
- `~/todox-lab/runs/2026-11-22-v2/r1/scores.md`
- `~/todox-lab/runs/2026-11-22-v2/r2/scores.md`

## Hedefler

| metrik | v1 | v2 r1 | v2 r2 | hedef | sonuç |
|---|---|---|---|---|---|
| hatırlama (sonraki oturumlar) | 6/9 | 7/9 | 7/9 | ≥ 7/9 | **tuttu** |
| Jonas kayıt (entry + not) | 0 | 1 | 1 | ≥ 1 | **tuttu** |
| log'a düşen soru | 0 | 1 | 2 | — | iyileşti |
| işaretli oturumda cevaplanan soru | 0/2 | 0/2 | 0/2 | 2/2 | tutmadı |
| ret | 6 | 6 | 9 | ≤ 2 | tutmadı |
| todox'a hiç dokunmayan oturum | can s1, s2 | can s1, s2, s3 | can s1, s2 | 0 | tutmadı |
| notesWritten (görevsiz "neden") | 0 | 1 | 1 | — | iyileşti |
| handoff | 7/15 | 7/15 | 5/15 | — | r2'de düştü |
| ctx first | 12/15 | 12/15 | 13/15 | — | aynı |
| ort. briefing | 2.2 KB | 2.1 KB | 2.6 KB | — | aynı bant |
| maliyet | $1.53 | $1.5 | $1.6 | — | aynı |

## Neden tutmadı

### Retlerin yarısı Claude Code'un ertelenmiş şemalarından geliyor

Claude Code, MCP tool şemalarını ilk kullanıma kadar yüklemiyor. Bu yüzden bir tool'un ilk çağrısı tahmini argümanla gidiyor:

- `get_task {"id": "651"}`: string, `task_id` yok;
- `update_task {"id": "650", …}`;
- `get_context {}`.

İkinci çağrı her seferinde doğru gidiyor; transcript'te ret ile hemen ardından gelen doğru çağrı yan yana duruyor. Bu desen v2'de 9 retin 4'ü (r2), 6'nın 3'ü (r1).

B18'de `get_task` sayı olarak `id` kabul eder hale geldi. Ama tahmin string (`"651"`) geliyor, `update_task` ise hiç `id` kabul etmiyor.

**Aday düzeltme:** `task_id` alan her tool'da `id` takma adını kabul et, rakamdan oluşan string'i sayıya çevir. Şema `anyOf` olur. Bu değişiklik araç yüzeyini etkilediği için karar sizde.

### Kalan retler hosted modda yeni checkout'ta `get_context`'in reddi

Örnekler: Ayşe'nin klonladığı `ledger-api` ve Elif'in `invoicely-mobile`'ı. Sunucunun diski yok; `repo_url` gelmeden bir dizini proje sayamaz. Bu kasıtlı ve doğru.

Agent'lar artık bir kez yeniden deniyor; B7'nin talimat kısmı işledi.

Ret mesajı (`lib/services/project-resolver.ts` `noEvidence`) önce `repo_root` ya da `repo_url` istiyor. `project`'i yalnızca "bu bir scratch dizinse" diye öneriyor. Ama mesajın sonuna hesabın slug listesi ekleniyor ("Known slugs: ledger-api, platform-infra").

Elif s3 r2'de agent `repo_url` göndermek yerine listeden `project: "invoicely"` seçti ve mobil repoyu web projesinin briefing'iyle açtı. Bu, "proje bir repodur" kuralının agent eliyle delinmesi. Ayşe ise iki tekrarda da paylaşılan `ledger-api`'ye `project` ile döndü; onun için doğru seçim buydu.

**Aday düzeltme:** checkout'u olan bir dizin reddedildiğinde slug listesi verilmesin ya da listenin önüne "önce `git remote get-url origin` ile `repo_url` gönder; slug yalnızca bu repo o projenin klonuysa" yazılsın.

### Can (Haiku + OpenCode) todox'a hâlâ ulaşmıyor

Lab personalarının hafıza dosyası yok. Claude `--setting-sources project` ile koşuyor, OpenCode özel bir XDG ile. B6'nın düzeltmesi kurulumun alışkanlığı varsayılan olarak yazması; lab bu adımı taklit etmediği için ölçemedi.

**Karar gerekiyor:** lab'da Can'a kurulumun yazacağı snippet'i koymak, gerçek bir yeni kullanıcıyı daha iyi temsil eder. Ama v1 ile karşılaştırmayı bozar.

### İşaretli soru oturumları

Ayşe s1 seçimi hâlâ sohbette bırakıyor; log'a soru açılmıyor. Can todox'a dokunmuyor. Soru davranışı ise başka yerde başladı:

- r1'de Mert s3 bir soru açtı;
- r2'de Mert s2'nin sorusunu Mert s3 `answers_entry_id` ile kapattı.

Metrik yalnızca senaryoda işaretlenen iki oturuma bakıyor, bu yüzden 0/2 gösteriyor.

## Sonuç

Talimat ve briefing değişiklikleri ölçülebilir iyileşme getirdi:
- hatırlama 6/9'dan 7/9'a çıktı;
- log'a soru düşmeye başladı;
- görevsiz "neden" notu ilk kez yazıldı;
- sessiz kalan Jonas bir kayıt bıraktı.

Ret ve küçük model hedefleri tutmadı. Bunların nedeni sunucu talimatı değil: Claude Code'un şema yükleme davranışı, ret mesajının öneri sırası ve lab'ın kurulumu taklit etmemesi. Üçü için aday düzeltmeler yukarıda.

İki tekrar arasındaki fark (handoff 7 → 5, ret 6 → 9), tek koşunun ne kadar gürültülü olduğunu gösteriyor.
