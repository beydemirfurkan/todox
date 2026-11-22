# Elif: Aynı repoda "devam et" kusursuz, ama iki projem arasında köprü yok; mobil repo todox için hiç var olmadı

## Who I am and what I tried
Elif, İzmir'de tek başıma `invoicely` (API) ve `invoicely-mobile` (telefon uygulaması) çalıştırıyorum. s1'de KDV yuvarlama hatasını düzelttirdim ve indirim kodunun tasarımını yaptırıp durdum. s2'de sadece "Dünkü işe devam edelim." dedim, s3'te mobil repoya geçip "API tarafında indirimi nasıl modellediğimizi hatırlıyor musun?" diye sordum.

## What worked

- **s2 indirim tasarımını bana tekrar anlattırmadan aldı.** Bu ürünün bana vaat ettiği tek şey buydu ve oldu. Briefing (`elif-s2/transcript.jsonl` L6, 2.9 KB) görev #349'u son handoff'un tam gövdesiyle getirdi, içinde `"Decision: percent is a plain 0-100 number (floats allowed), fixed is integer kuruş capped at subtotal; one discount per invoice."` satırı da vardı. Ajan bir sonraki adımda (L8) doğrudan koda baktı, bana tek soru sormadı. Oturum 26 saniye sürdü, 0,12 $ tuttu, 13 test yeşil.
- **s2 benim cevaplamadığım soruları kendisi karara bağladı ve bunu söyledi.** s1 bana iki soru bırakmıştı (bellekte mi kalıcı mı, kullanım limiti şart mı). s2 beni beklemedi: handoff'a `"Assumed (user never answered): in-memory, usage limits included as optional."` yazdı (L25), bana da "İstersen değiştiririz" dedi. Benim istediğim tam olarak bu.
- **s1 handoff'u iyi yazmış.** Kısa, ilk satırı başlık gibi, "Watch:" kısmında web uygulamasının yeni `discount`/`net` alanlarını bilmeyebileceğini söylüyor (`elif-s1` L96). s2 bunu aynen taşıdı.
- **s3 kararı başka projede bulabildi, ama sadece `search` ile.** `get_context` reddedildikten sonra ajan `search("indirim discount API model invoice")` çağırdı. Bu çağrı proje filtresi olmadan iki `invoicely` handoff'unu ve görev #349'u getirdi (`elif-s3` L9–L10), ardından `get_task(349)` kararın tam metnini verdi (L19). Yani projeler arası arama çalışıyor.
- **todox beni yavaşlatmadı.** todox çağrıları s1'de 19 araç çağrısının 4'ü, s2'de 9'un 3'ü, s3'te 15'in 3'ü. Bunlara ToolSearch ile şema yüklemek için 1, 2 ve 2 çağrı ekleniyor. Transcript zaman damgalarına göre todox çağrılarının toplam bekleme süresi oturum başına 0,1–0,2 saniye. Briefing 1,6 / 2,9 / 0,6 KB. Asıl iş (test yazmak, düzeltmek) her oturumda baskın. Kapanış mesajlarında todox'a ayrılan yer bir iki cümle; s1'deki "remote yok" uyarısı bile tek paragraf.
- **Proje panosunda son handoff'un ilk satırı kartın üstünde duruyor** (`shots/elif-project.png`): "Registry + POST /invoices discountCode done, uncommitted; 13 tests green." Bir bakışta neredeyim görüyorum, ama bunun için projeye girmem gerekiyor.

## What got in my way

- **[painful] Mobil repo todox'a hiç kaydolmadı, s3'te yapılan iş iz bırakmadı.** `get_context` şu mesajla reddedildi (`elif-s3` L8):
  `error: no repository at ~/todox-lab/elif/invoicely-mobile. ... Send repo_root -- the directory holding .git -- or repo_url ...`
  Ajan hemen ardından `git remote get-url origin` çalıştırıp URL'yi aldı (L16–L17: `https://github.com/todox-lab-elif/invoicely-mobile.git`), ama çağrıyı bir daha denemedi. Sonuç:
  - mobil proje hesabımda yok (`state.json` içinde tek proje `invoicely`);
  - sync kuyruğu düzeltmesi ve indirim satırı hiçbir yere yazılmadı;
  - "kalıcı hata veren aksiyon kuyruğu bloklar, `attempts` için üst sınır yok" diye açık bir ürün sorusu vardı, o da kayboldu.

  Mesajın sonunda bana "İsterseniz kaydedeyim." dedi. Hayır, sormadan kaydetsin, bu muhasebeyi ben yapmak istemiyorum.

  Kabahatin yarısı modelde: düzeltmeyi elindeyken yapmadı. Diğer yarısı todox'ta:
  - Sunucu talimatı `"A REFUSED WRITE names what is missing: send it and retry once."` diyor (`mcp/tools.ts:121`), `get_context` ise yazma değil. Ajan kuralın kendisine uymadığını düşünmüş olabilir.
  - Hosted modda yeni bir repoda ilk çağrının reddedilmesi zaten tasarım gereği. O zaman "tekrar dene" kuralı her reddi kapsamalı.
- **[painful] Bir projede alınan karar diğer projeye briefing'le değil, şansla ulaştı.** s1 kararı (indirim modeli) yalnızca bir handoff'un son satırına gömdü. Ne `kind:'decision'` olarak kaydetti ne de projesiz `add_context` ile hesap geneline yazdı. Ürünün bunun için bir yeri var, `/me` sayfası boş halini şöyle anlatıyor: "Projeler arası bilgi burada yaşar: değişmeyen tercihlerin, her repoyu bağlayan kararlar..." (`shots/elif-me.png`). Ama hiçbir ajan oraya yazmadı ve hiçbir şey onları buna yöneltmedi:
  - Her briefing'deki hint yalnızca `add_context(kind:'profile'|'stack'|'workflow')` diyor (`elif-s1` L10, `elif-s2` L6). Projeler arası karardan söz etmiyor.
  - Oturum kapanış protokolü (session_status → update_task → dead_end → handoff) "bu karar başka bir repoyu bağlıyor mu?" diye sormuyor.

  `/me` bu yüzden `invoicely · 2 kayıt · 1 açık · 0 karar` gösteriyor, oysa bu iki oturumda bir indirim modeli karara bağlandı. s3'ün kararı bulması tamamen ajanın `search` çağırmayı akıl etmesine kaldı. Ajan sonra yine de `../invoicely` repo'sunu diskten okudu (L28) ve bana "Hatırlıyorum diyemem, ama API'nin indirim modelini `../invoicely` repo'sundan okudum" dedi. API repo'su kardeş klasörde olmasaydı tek dayanağı search olurdu.
- **[annoying] Ana sayfada iki projemin nerede durduğu görünmüyor** (`shots/elif-home.png`):
  - Mobil proje hiç yok.
  - `invoicely` "Sessiz" altında katlanmış duruyor ve sadece "1 sırada · 7 dk önce" yazıyor.
  - Üstteki dört sayaç da sıfır: "0 uçuştaki proje · 0 üzerinde çalışılan görev". Oysa son on dakikada iki oturum bu proje üzerinde çalıştı.

  Bunun sebebi görevi hiçbir oturumun `doing` yapmaması (s1 `create_task` ile `todo` açtı, s2 `update_task` ile `todo` bıraktı, `elif-s2` L27). Model kuralı atlamış, ama ana sayfa da en son ne olduğunu göstermek yerine sadece statüye bakıyor. Bir bakışta göremiyorum, tıklamam gerekiyor.
- **[annoying] Ajan girdileri benim adımla görünüyor.** Proje panelinde ve görev sayfasında iki handoff da "yazan Elif Kaya" olarak duruyor (`shots/elif-project.png`, `shots/elif-task.png`). Satırda `author: "agent"` ve `model: "claude-sonnet-5-5"` kayıtlı (`elif-s2/state.json`), ama ekranda ikisi de görünmüyor. Bu satırları ben yazmadım. Hangisini ajanın varsaydığını bilmem lazım, mesela "Assumed (user never answered)" diyen satırı.
- **[annoying] Bana bırakılan sorular "seni bekliyor"a hiç düşmedi.** s1 iki soruyu görev gövdesine yazdı ("Open for the user: where codes live..., usage limits needed?"), `log_entry(kind:'question')` kullanmadı. Ana sayfada "0 seni bekliyor" yazıyor. s2 soruları kendisi çözdüğü için bu sefer zarar etmedi, ama s3'ün mobil kuyruk sorusu (üst sınır var mı) zaten hiçbir yere yazılmadı.

## What is missing

- **Projeleri birbirine bağlamanın bir yolu.** `invoicely` ile `invoicely-mobile` aynı ürünün iki yüzü. Hesap geneli not bir çözüm, ama kaba: indirim modeli ileride başka bir yan projemin briefing'ine de girer. Ben "bu iki proje birbirine bağlı, birinin kararları diğerinin briefing'inde görünsün" demek isterdim. Bunu beklememin sebebi, README'nin ürünü projeler arası bir hafıza olarak anlatması (`README.md:313`: "A cross-project memory installed into one project is the thing this whole section exists to avoid").
- **Ana sayfada her projenin son handoff başlığı.** Proje kartında zaten var. Ana sayfa satırında da görsem, sabah tek ekranda iki projemin nerede kaldığını okurum.
- **Beynim boş.** Üç oturumdan sonra `/me`'de "0 senin hakkında not, 0 her yerde geçerli kural" yazıyor (`shots/elif-me.png`). Her briefing ajana "Nothing is recorded about this developer yet" diyor, yine de hiçbiri bir şey yazmadı. Halbuki Türkçe yazdığım, commit atılmamasını beklediğim ve tutarların kuruş cinsinden tam sayı olduğu belliydi. "Düşüncen nerede" grafiği tek bir düğüm ("sen → invoicely") ve bana hiçbir şey söylemiyor. Şu haliyle `/me` bir sayfa, araç değil. Dolu olsaydı ve her repoyu bağlayan kararlar orada dursaydı, en çok kullanacağım sayfa olurdu.

## Would I keep using it?

**Henüz değil.** Tek repoda "devam et" dediğimde bir şey anlatmak zorunda kalmamam bana para kazandırıyor ve bunu s2'de gördüm. Ama iki projem var ve bunlardan birinde yapılan iş todox için hiç var olmadı. Kararı flip edecek tek değişiklik şu: reddedilen `get_context` dahil her red bir kez tekrar denensin ve kapanış protokolü "bu karar başka bir repoyu bağlıyor mu? O zaman projesiz `add_context(kind:'decision')`" diye sorsun. Böylece API'de alınan karar mobilin briefing'inde kendiliğinden görünür.

## Findings

| id | title | severity | area | evidence | suggested fix |
|---|---|---|---|---|---|
| elif-1 | Reddedilen `get_context` tekrar denenmedi; mobil repo kaydolmadı, s3'ün işi ve açık sorusu kayboldu | painful | tools / agent behaviour | `elif-s3` L8 (red), L16–L17 (remote URL alındı, retry yok), son mesaj "İsterseniz kaydedeyim"; `state.json` tek proje | `mcp/tools.ts:121` "A REFUSED WRITE" yerine "A REFUSED CALL" desin; `get_context` reddinde hazır retry çağrısı (`repo_root: <cwd>`) zaten var, talimat bunun her red için geçerli olduğunu açıkça söylesin. Model tarafı: ajan elindeki URL'yi kullanmadı. |
| elif-2 | Projeler arası karar için ajanı yönlendiren hiçbir şey yok; karar handoff'a gömüldü | painful | briefing / tools | `elif-s1` L96 "Decision: ..." handoff içinde; briefing hint'i sadece profile/stack/workflow (`elif-s1` L10); `/me` "0 karar", "Her projede geçerli kurallar" boş (`shots/elif-me.png`) | Kapanış protokolüne bir adım: "bir başka repo bu karara bağlıysa `add_context(kind:'decision')` projesiz". Hint, kullanıcının birden fazla projesi olduğunda bunu da önersin. Uzun vadede proje grubu/bağlı projeler. |
| elif-3 | s3 kararı ancak `search` ile buldu; briefing taşımadı | annoying | briefing | `elif-s3` L9–L10, L19; ardından L28'de kardeş repoyu diskten okudu | elif-2 çözülürse hesap geneli kural her briefing'de gelir. Ayrıca `get_context` reddedildiğinde bile hesap geneli kuralları döndürebilir. |
| elif-4 | Ana sayfa projelerin nerede durduğunu göstermiyor; çalışılmış proje "Sessiz" ve "0 uçuşta" | annoying | web UI | `shots/elif-home.png`; görev hiç `doing` olmadı (`elif-s2` L27) | Ana sayfa satırında son handoff'un ilk satırı ve "son oturum X dk önce" olsun; "uçuşta" yalnız statüye değil son aktiviteye de baksın. |
| elif-5 | Ajan girdileri "yazan Elif Kaya" olarak görünüyor, model gösterilmiyor | annoying | web UI | `shots/elif-task.png`, `shots/elif-project.png`; satırda `author: "agent"`, `model: "claude-sonnet-5-5"` | `author = agent` ise "ajan · claude-sonnet-5-5 (Elif adına)" göster. |
| elif-6 | Bana bırakılan sorular görev gövdesinde kaldı, "seni bekliyor" sıfır | annoying | agent behaviour / tools | `elif-s1` L94 task body "Open for the user: ..."; ana sayfa "0 seni bekliyor" | `create_task` açıklaması, gövdedeki "kullanıcıya soru" metni için `log_entry(kind:'question')` önersin; session_status bunu yakalayabilir. |
| elif-7 | Beyin (`/me`) üç oturum sonra bomboş; hint her seferinde verildi ama hiçbir ajan profil yazmadı | annoying | agent behaviour / briefing | `elif-s1` L10 ve `elif-s2` L6 hint "Nothing is recorded about this developer yet"; `shots/elif-me.png` | Hint'i kapanış protokolüne taşı (başta söylenip unutuluyor); s1 sonunda "öğrendiğin bir şey var mı" adımı. |
| elif-8 | todox ek yükü düşük | – (olumlu) | tools | todox çağrıları 4/19, 3/9, 3/15; bekleme süresi oturum başına ≤0,2 s; briefing ≤2,9 KB | Yok. Böyle kalsın. |
