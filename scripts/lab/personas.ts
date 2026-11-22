import type { FixtureName } from "./fixtures";

/**
 * The developers the lab simulates, and what each of them asks their agent
 * to do across three sessions.
 *
 * The prompts are written in the persona's voice and never mention todox:
 * the agent finds it the way a real one does, through the MCP server's own
 * instructions, so what the lab measures is the product and not the prompt.
 * Session two is deliberately thin ("carry on") -- the only way to know what
 * "on" means is whatever session one left behind.
 */

export type AgentKind = "claude" | "opencode";
export type PersonaKey = "elif" | "mert" | "ayse" | "can" | "jonas";

export interface LabProject {
  /** Directory under the persona's folder, and the fixture it starts from. */
  name: FixtureName;
  /** A clone of another persona's checkout: same remote, so the same project. */
  cloneOf?: PersonaKey;
}

export interface Session {
  project: FixtureName;
  agent: AgentKind;
  prompt: string;
  /** Runs only once that persona's session has finished (a teammate's note, say). */
  after?: { persona: PersonaKey; session: 1 | 2 | 3 };
  /**
   * What only an earlier session knew, as a case-insensitive pattern the
   * agent's final answer should match: the recall the session cannot fake from
   * its own prompt. Scored by score.ts.
   */
  recall?: string;
  /** The developer answers an open question here; a logged answer should follow. */
  answersQuestion?: boolean;
}

export interface Persona {
  key: PersonaKey;
  username: string;
  name: string;
  lang: "tr" | "en";
  /** One line: who they are. The reviewer agent carries the rest. */
  role: string;
  projects: LabProject[];
  sessions: [Session, Session, Session];
}

/** Every remote is fake and on a host nobody will push to. */
export const remoteFor = (owner: PersonaKey, project: string) =>
  `https://github.com/todox-lab-${owner}/${project}.git`;

export const PERSONAS: Persona[] = [
  {
    key: "elif",
    username: "lab-elif",
    name: "Elif Kaya",
    lang: "tr",
    role: "Solo indie hacker; ships a SaaS and its mobile app alone, hates ceremony.",
    projects: [{ name: "invoicely" }, { name: "invoicely-mobile" }],
    sessions: [
      {
        project: "invoicely",
        agent: "claude",
        prompt:
          "Bir müşterim 3 kalemli bir faturada KDV'nin 1 kuruş fazla çıktığını söyledi. Bul, düzelt, test ekle. " +
          "Sonra indirim kodu desteğine başlayalım: yüzde ya da sabit tutar olabilir, KDV'den önce uygulanmalı. " +
          "Bugün sadece tasarımı netleştir ve ilk adımı at, gerisi yarın; bir saate çıkmam lazım.",
      },
      {
        project: "invoicely",
        agent: "claude",
        prompt: "Dünkü işe devam edelim.",
        recall: "indirim|discount",
      },
      {
        project: "invoicely-mobile",
        agent: "claude",
        prompt:
          "Mobil uygulamada bir kullanıcının telefonu ısınıyormuş, sync kuyruğu takılıp kalıyor sanırım, bir bak. " +
          "Bir de fatura ekranında indirim satırını göstermemiz lazım. API tarafında indirimi nasıl modellediğimizi " +
          "hatırlıyor musun? Ona uygun yap.",
        recall: "yüzde|percent|sabit|fixed|kdv.{0,40}önce|before.{0,20}(vat|tax)",
      },
    ],
  },
  {
    key: "mert",
    username: "lab-mert",
    name: "Mert Demir",
    lang: "tr",
    role: "Backend engineer at a payments startup; switches editors and agents depending on the day.",
    projects: [{ name: "ledger-api" }],
    sessions: [
      {
        project: "ledger-api",
        agent: "claude",
        prompt:
          "Yük testinde toplam bakiye kayıyor; para ya yoktan var oluyor ya kayboluyor. Kök nedeni bul, düzelt, -race ile kanıtla. " +
          "Sonra idempotency key konusunu düşün: client'lar timeout'ta aynı isteği tekrar gönderiyor. " +
          "Bugün sadece yaklaşımı seç ve başla, bitirmek zorunda değilsin.",
      },
      {
        project: "ledger-api",
        agent: "claude",
        prompt: "Idempotency işine devam.",
        recall: "mutex|lock|kilit|race|yarış",
      },
      {
        project: "ledger-api",
        agent: "opencode",
        after: { persona: "ayse", session: 2 },
        prompt:
          "Bugün başka bir editörden çalışıyorum. Idempotency key işi nerede kaldı, ne eksik? Bitir, testler yeşil olsun. " +
          "Ekipten biri bir soru ya da not bıraktıysa ona da bak.",
        recall: "ayşe|ayse",
      },
    ],
  },
  {
    key: "ayse",
    username: "lab-ayse",
    name: "Ayşe Yıldız",
    lang: "tr",
    role: "Tech lead; owns the infrastructure, reviews the ledger team, reports to a manager every Friday.",
    projects: [{ name: "platform-infra" }, { name: "ledger-api", cloneOf: "mert" }],
    sessions: [
      {
        project: "platform-infra",
        agent: "claude",
        prompt:
          "Güvenlik taraması ledger veritabanının internete açık olduğunu söylüyor. Düzelt. " +
          "Finans da her kaynakta cost-center tag'i zorunlu kılıyor. Bunu nasıl uygulayacağımızı planla; " +
          "bugün sadece seçenekleri çıkar ve kararı bana bırak, ben seçeceğim.",
      },
      {
        project: "ledger-api",
        agent: "claude",
        after: { persona: "mert", session: 2 },
        prompt:
          "Mert bu hafta ledger-api'de ne yaptı? Neye karar verdi, neyi denedi de işe yaramadı, açık bir soru var mı? " +
          "Yöneticime gidecek 5 satırlık bir özet hazırla. Idempotency tasarımında bir risk görürsen Mert için not bırak.",
        recall: "mutex|lock|kilit|race|yarış",
      },
      {
        project: "platform-infra",
        agent: "claude",
        prompt:
          "Tag konusu: provider seviyesinde default_tags kullanalım, modül modül değil. Dün sorduğun sorunun cevabı bu. Uygula.",
        recall: "0\\.0\\.0\\.0|publicly_accessible|security group|güvenlik grubu",
        answersQuestion: true,
      },
    ],
  },
  {
    key: "can",
    username: "lab-can",
    name: "Can Arslan",
    lang: "tr",
    role: "Junior developer, three months in; learning, reads everything on a phone.",
    projects: [{ name: "price-scraper" }],
    sessions: [
      {
        project: "price-scraper",
        agent: "opencode",
        prompt:
          "Merhaba, fiyatlar yanlış çıkıyor galiba. 1.299,90 TL olan kulaklık 1.2999 gibi bir şey çıkıyor. " +
          "Düzeltebilir misin? Nasıl düzelttiğini de bana anlatır mısın, öğrenmek istiyorum.",
      },
      {
        project: "price-scraper",
        agent: "opencode",
        prompt:
          "CSV'ye aktarma özelliği lazım. Hangi kolonlar olmalı emin değilim; sen öner, ben hocama sorup karar vereceğim. " +
          "Karar verene kadar sadece hazırlık yap.",
      },
      {
        project: "price-scraper",
        agent: "opencode",
        prompt: "Hocam kolonlar ad, fiyat, para birimi ve tarih olsun dedi. Dün sorduğun sorunun cevabı bu. Devam edelim.",
        recall: "virgül|comma|nokta|binlik|thousands|1\\.299",
        answersQuestion: true,
      },
    ],
  },
  {
    key: "jonas",
    username: "lab-jonas",
    name: "Jonas Becker",
    lang: "en",
    role: "Open-source maintainer; sceptical of tools, self-hosts everything, allergic to noise.",
    projects: [{ name: "tidyfs" }],
    sessions: [
      {
        project: "tidyfs",
        agent: "claude",
        prompt:
          "Issue #12: tidyfs hangs forever on a directory that contains a symlink loop (ln -s .. loop). " +
          "Fix it and add a regression test. Don't write me essays.",
      },
      {
        project: "tidyfs",
        agent: "claude",
        prompt:
          "Next: a --json output flag for scripting. Before you start, remind me in two lines why the symlink fix works the way it does.",
        recall: "realpath|inode|visited|lstat|st_dev",
      },
      {
        project: "tidyfs",
        agent: "claude",
        prompt:
          "I'm deciding whether to keep this memory tool connected. Look at everything it has recorded about tidyfs and tell me " +
          "bluntly what is useful and what is noise. Then clean up whatever is noise.",
        recall: "json|symlink",
      },
    ],
  },
];

export const personaByKey = (key: string) => PERSONAS.find((p) => p.key === key);
