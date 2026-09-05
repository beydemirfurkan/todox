import type { ContextKind, EntryKind } from "../../lib/constants";

/**
 * A small, fixed log, and the questions a later session would ask of it.
 *
 * Written rather than sampled from a real account for two reasons: a benchmark
 * that needs somebody's production data is one nobody else can run, and one
 * whose corpus changes underneath it cannot compare two runs. This is the same
 * argument the smoke suites make for seeding their own scratch project.
 *
 * The style is copied from real todox records on purpose — long bodies, a
 * reason rather than a summary, and half of it in Turkish, because that is what
 * this log actually looks like and a corpus of tidy English sentences would
 * flatter every retrieval strategy that gets measured against it.
 */

export type Note = { kind: ContextKind; title: string; body: string };
export type Task = {
  title: string;
  body: string;
  entries: { kind: EntryKind; body: string }[];
};

/**
 * Each question, the way an agent would actually type it, and the record that
 * answers it.
 *
 * `asked` is the natural-language form — the shape the tool description used to
 * invite. `term` is the same question narrowed to one distinctive word or an
 * exact phrase, which is what the corrected description now asks for. Running
 * both against the same corpus is how the difference stops being an opinion.
 *
 * The corpus holds two shapes on purpose that a single strategy cannot cover.
 * One is cross-language: "a tool returns an empty object" is answered by a note
 * written in Turkish, and the term anybody reaches for is English — which
 * substring search never found, and full-text only finds because the Turkish
 * note happens to contain the English loanword. The other is the middle of an
 * identifier: `FileSync` inside `readFileSync`, which full-text cannot reach at
 * all because it tokenises on word boundaries, and which the ILIKE arm under
 * the index is there for. Removing that arm takes the term column from 24/24
 * to 23/24, which is the measurement that keeps it.
 */
export type Question = {
  asked: string;
  term: string;
  /** Title of the note or task that answers it. Resolved to an id after seeding. */
  answer: string;
  answerType: "context" | "task";
};

export const NOTES: Note[] = [
  {
    kind: "convention",
    title: "Ownership is asserted in one place",
    body:
      "Every read and write that takes an id off the wire goes through lib/services/ownership.ts. " +
      "Do not inline a WHERE user_id = ? at the call site: it looks identical and it is not, because " +
      "the next person adding a method copies the call site they can see. A row belonging to somebody " +
      "else answers 404 rather than 403 — the message must not tell a caller that an id exists.",
  },
  {
    kind: "gotcha",
    title: "Bir ownership sorgusunda parametreyi değil WHERE'i doğrula",
    body:
      "\"Hesap id'si sorgu parametrelerinde geçiyor\" test edilmeye değer görünüyor ve neredeyse " +
      "işe yaramaz. WHERE'den ownership koşulunu silmek hesabı LEFT JOIN'de bağlı bırakıyor ve " +
      "parametre sayısını değiştirmiyor, yani sorgu tablodaki her satır için evet demeye başlıyor " +
      "ve o iddia hâlâ geçiyor. WHERE'in bir hesap kolonuna kısıt koyduğunu doğrula.",
  },
  {
    kind: "decision",
    title: "Şifreler scrypt ile, bcrypt değil",
    body:
      "scrypt seçildi çünkü bellek-zor ve Node'un kendi crypto modülünde var, yani yeni bir " +
      "bağımlılık gerekmiyor. Bedeli istek başına yaklaşık 16 MB ve 80 ms; bu kasıtlı ve login " +
      "hız sınırının neden IP başına olması gerektiğinin de sebebi. bcrypt elendi: native derleme " +
      "istiyor ve maliyeti yalnızca CPU'da, bellekte değil.",
  },
  {
    kind: "gotcha",
    title: "A deploy and a migration are separate steps",
    body:
      "db:migrate deliberately does not run on cold start, which means there is always a window " +
      "where new code meets an old schema. Anything that only works in one order is a broken window " +
      "waiting to happen: an ON CONFLICT naming an index the migration has not created yet fails the " +
      "whole statement. Write the statement so it behaves the same before and after — NOT EXISTS " +
      "rather than a conflict target — and let the migration be a backstop.",
  },
  {
    kind: "convention",
    title: "No question mark inside a SQL string literal",
    body:
      "lib/db/client.ts rewrites ? to $n positionally and does not parse strings, so a question mark " +
      "inside a quoted literal shifts every parameter after it. This is not theoretical: it produces " +
      "a query that runs and returns the wrong rows rather than one that errors.",
  },
  {
    kind: "gotcha",
    title: "overflow-x: clip layout hatalarını metni keserek gizliyor",
    body:
      "globals.css'teki html, body { overflow-x: clip } giriş animasyonunun dönüşü için bir ağ. " +
      "Gerçek layout hatalarını da yakalıyor ve yakaladığı için sayfa hiç yana kaymıyor — yani " +
      "olağan belirti hiç görünmüyor ve hata hayatta kalıyor. Kullanıcıya cümle ortasında biten " +
      "metin olarak okunuyor, ki bu kaydırma çubuğundan çok daha kötü.",
  },
  {
    kind: "decision",
    title: "English is the default language, Turkish is not a translation",
    body:
      "A client that states no Accept-Language is usually not a person: Googlebot and every " +
      "link-preview fetcher send none, so a Turkish default meant every search result and every " +
      "pasted link was Turkish. A Turkish browser sends tr and still gets Turkish. Write the Turkish " +
      "properly rather than machine-translating it — it is a first-class language here.",
  },
  {
    kind: "convention",
    title: "Repositories never call each other",
    body:
      "One module per table, no cross-table logic. Anything that must stay consistent across tables — " +
      "a status change writing a task_events row, say — belongs in lib/services/. The rule exists " +
      "because a repository that reaches into another table is the one place a transaction boundary " +
      "goes missing without anybody noticing.",
  },
  {
    kind: "gotcha",
    title: "Kendi yazdığını geri okuyan kurulum hiçbir şey kanıtlamaz",
    body:
      "VS Code kurulumu macOS'ta ~/.config/Code/User'a yazıyordu, oysa VS Code " +
      "~/Library/Application Support/Code/User'dan okuyor. Dizin Mac'te yok, yani yazmak onu " +
      "oluşturdu ve verify() aynı yanlış yolu geri okuyup başarı bildirdi. Yeşil kurulum, araç hiç " +
      "görünmüyor. Doğrulama, yazdığın yeri değil okunacak yeri kontrol etmeli.",
  },
  {
    kind: "preference",
    title: "Commit messages answer why, not what",
    body:
      "The diff already shows what changed. The body is for the reason the change was worth making, " +
      "the alternative that lost, and anything the next reader would otherwise have to rediscover. " +
      "Conventional Commits for the subject line, under 72 characters, imperative, no trailing period.",
  },
  {
    kind: "decision",
    title: "Self-host is the permanent home, todox.dev is the try-it tier",
    body:
      "The hosted instance is one small server with no uptime promise, and saying so is more honest " +
      "than pretending otherwise. What this forces is export: if you cannot take your log with you, " +
      "\"run your own\" is an empty sentence. That is why /api/export exists and why the delete-project " +
      "copy had to stop saying there is no way out.",
  },
  {
    kind: "gotcha",
    title: "MCP clients default to per-project installs, and fail silently",
    body:
      "claude mcp add writes to local scope unless told otherwise, and local means the directory it " +
      "ran in. Cursor and VS Code both read a config inside the checkout by default. For a " +
      "cross-project memory this is the wrong default in the most expensive way: in the next " +
      "repository the tools are simply absent, so nothing errors and the agent never mentions todox.",
  },
  {
    kind: "convention",
    title: "Renkler tek başına anlam taşımaz",
    body:
      "Her durumun, türün ve rozetin bir metin karşılığı var ve her kontrolün gerçek bir etiketi. " +
      "Yalnızca renkle ayrılan bir durum, renk körü bir okuyucu için hiç ayrılmamış demek — ve " +
      "ekran okuyucu için de öyle.",
  },
  {
    kind: "decision",
    title: "Reports are replayed from task_events, never guessed from updated_at",
    body:
      "Every status change is a row, so a duration is a replay rather than a subtraction. This is why " +
      "one dropped event once added a permanent 24 hours to every daily report after it: the interval " +
      "never closed. A closed task's open interval stops at closed_at, not at now().",
  },
  {
    kind: "gotcha",
    title: "Bir aracın {} döndürmesi bağlı görünmesini engellemiyor",
    body:
      "get_context her ajana ve her iki transport'ta {} döndürüyordu, çünkü transform'u async ve " +
      "çağrı yeri onu await etmiyordu. Bekleyen bir promise'in JSON.stringify'ı tam olarak {}. " +
      "Hiçbir şey yakalamadı: TypeScript yakalayamaz, testler yalnızca dışarı gideni doğruluyordu, " +
      "ve dışarıdan sağlıklı görünüyor — araç listeleniyor, cevap veriyor, hata bildirmiyor.",
  },
  {
    kind: "convention",
    title: "Never build a SET clause by hand",
    body:
      "Use setClause(patch, COLUMNS) from lib/db/client.ts. Column names cannot be bound as " +
      "parameters so they get interpolated, and patches arrive from a rest-spread at the RPC " +
      "boundary — iterating the patch's own keys put caller-chosen text into the statement. " +
      "That was a live SQL injection, not a hypothetical one.",
  },
  {
    kind: "decision",
    title: "Bir proje bir depodur, bir yol değil",
    body:
      "root_path bir deponun bir makinedeki yeri ve bir sonrakinde başka bir string, o yüzden kimlik " +
      "önce repo_url. Ad tek başına asla yetmez: ~/work/api ve ~/personal/api iki ayrı depo, ve " +
      "günlüklerini birleştirmek bir kopyadan daha kötü — çünkü kopya görünür, kötü birleşme değil.",
  },
  {
    kind: "preference",
    title: "Comments are the last resort",
    body:
      "Code that needs a comment usually needs better names first. What earns a comment is the thing " +
      "the code cannot say: the alternative that lost, the bug that produced this shape, the " +
      "constraint from somewhere else. Restating the diff does not.",
  },
];

export const TASKS: Task[] = [
  {
    title: "Rate limit login attempts per IP",
    body: "Brute force protection on the auth endpoints. Per IP, not per account, because an attacker picks the account.",
    entries: [
      {
        kind: "dead_end",
        body:
          "Tried limiting per account id first. Useless against the attack that matters: somebody " +
          "spraying one password across many accounts never trips a per-account counter. Worse, it " +
          "hands an attacker a way to lock a real user out by failing their login on purpose.",
      },
      {
        kind: "decision",
        body:
          "Fixed window rather than sliding: a sliding window needs the timestamps kept, and the " +
          "extra precision buys nothing when the limit is twenty per fifteen minutes.",
      },
      { kind: "handoff", body: "Landed. The IP has to come from the trusted-proxy chain, not the leftmost hop." },
    ],
  },
  {
    title: "Görev listesini indeksle",
    body: "Proje sayfası 20 binlik bir görev tablosunda yavaştı.",
    entries: [
      {
        kind: "dead_end",
        body:
          "Önce yalnızca (project_id, status) indeksi denendi ve hiçbir şey değişmedi, çünkü sorgu " +
          "priority ve updated_at ile sıralıyor. Planner indeksi kullanıp sonra hepsini yeniden " +
          "sıralıyordu, yani kazanç sıfır.",
      },
      {
        kind: "decision",
        body:
          "(project_id, priority, updated_at DESC) kondu. 33.5 ms'den 0.16 ms'ye indi — ama YALNIZCA " +
          "LIMIT ile birlikte. LIMIT olmadan indeks yine işe yaramıyor, o yüzden tavan SQL'de.",
      },
    ],
  },
  {
    title: "Move hashing to the machine that has the files",
    body: "Staleness detection was returning null for every ref.",
    entries: [
      {
        kind: "dead_end",
        body:
          "The server tried to hash the file itself. It has no checkout, so every hash it computed " +
          "was null, freshness answered unknown for ever, and the whole staleness feature quietly did " +
          "nothing. It also turned a caller-supplied path into a real readFileSync, which is the " +
          "second reason it had to move rather than be fixed in place.",
      },
      { kind: "decision", body: "Hashing belongs in mcp/workspace.ts, and hosted the agent is asked to send hashes instead." },
    ],
  },
  {
    title: "Export everything an account owns",
    body: "Self-host is the permanent home, so there has to be a way out.",
    entries: [
      {
        kind: "decision",
        body:
          "Refuses rather than truncates past 200,000 rows. A partial export that does not say it is " +
          "partial is the worst possible outcome for a file somebody is migrating with.",
      },
      { kind: "handoff", body: "Round trip is real: db:import loads an export back, nothing is overwritten." },
    ],
  },
  {
    title: "Dependabot lockfile repair",
    body: "main went red after two dependency PRs landed back to back.",
    entries: [
      {
        kind: "dead_end",
        body:
          "Assumed the second PR being green meant the merge would be. It does not: that check is " +
          "textual and the PR's own checks ran against its own tree, not against the merge result. " +
          "Both branches added a baseline-browser-mapping block in a different place, git found no " +
          "conflict and kept both, and the result was invalid YAML that pnpm refuses.",
      },
      {
        kind: "decision",
        body:
          "Restore the last good lockfile and let pnpm rewrite it against the merged package.json. " +
          "Cheaper next time: merge one, then rebase the second and let it re-resolve.",
      },
    ],
  },
  {
    title: "Fetch pnpm once, not on every install",
    body: "A deploy died mid-build with a socket error.",
    entries: [
      {
        kind: "dead_end",
        body:
          "First guess was disk pressure on the server. Wrong: 181 GB free, 7% used. The real cause " +
          "was corepack downloading pnpm inside the same layer as the dependency install, so any " +
          "network blip during that fetch killed the build.",
      },
      {
        kind: "decision",
        body:
          "corepack prepare in the base stage, with the version written out. A test holds the pin " +
          "against packageManager, because two pnpm versions can both accept one lockfile and " +
          "disagree about what it means.",
      },
    ],
  },
  {
    title: "Bir oturumun neyi okuduğunu ölçmek",
    body: "Brifingin maliyeti hiç ölçülmemişti.",
    entries: [
      {
        kind: "question",
        body: "Token mu bayt mı raporlamalı? Tokenizer yok, yani token bir tahmin olur ve tahmin karşılaştırılamaz.",
      },
    ],
  },
  {
    title: "Stop the briefing growing without bound",
    body: "Context notes came back in full, all of them, on every session.",
    entries: [
      {
        kind: "dead_end",
        body:
          "Truncating the bodies was the first instinct and it is wrong. Cutting a decision off " +
          "mid-sentence loses the reasoning that is the point of keeping it, and leaves the reader " +
          "unable to tell a short note from a shortened one.",
      },
      {
        kind: "decision",
        body:
          "Cap which notes carry a body, keep every title, and count the rest. A title with no body " +
          "is honestly incomplete; half a paragraph is misleading.",
      },
    ],
  },
];

export const QUESTIONS: Question[] = [
  {
    asked: "why did we choose scrypt instead of bcrypt for passwords?",
    term: "scrypt",
    answer: "Şifreler scrypt ile, bcrypt değil",
    answerType: "context",
  },
  {
    asked: "how should I test that a query checks ownership?",
    term: "ownership",
    answer: "Ownership is asserted in one place",
    answerType: "context",
  },
  {
    asked: "can I put a question mark inside a SQL string?",
    term: "string literal",
    answer: "No question mark inside a SQL string literal",
    answerType: "context",
  },
  {
    asked: "what happens if the migration has not run yet when new code deploys?",
    term: "ON CONFLICT",
    answer: "A deploy and a migration are separate steps",
    answerType: "context",
  },
  {
    asked: "why is text getting cut off on mobile without a scrollbar?",
    term: "overflow-x: clip",
    answer: "overflow-x: clip layout hatalarını metni keserek gizliyor",
    answerType: "context",
  },
  {
    asked: "which language should the site default to for a crawler?",
    term: "Accept-Language",
    answer: "English is the default language, Turkish is not a translation",
    answerType: "context",
  },
  {
    asked: "can one repository module read another table?",
    term: "Repositories never call each other",
    answer: "Repositories never call each other",
    answerType: "context",
  },
  {
    asked: "how do I build an update statement safely?",
    term: "setClause",
    answer: "Never build a SET clause by hand",
    answerType: "context",
  },
  {
    asked: "what identifies a project across two machines?",
    term: "repo_url",
    answer: "Bir proje bir depodur, bir yol değil",
    answerType: "context",
  },
  {
    asked: "why did the MCP server not get called in a new repo?",
    term: "local scope",
    answer: "MCP clients default to per-project installs, and fail silently",
    answerType: "context",
  },
  {
    asked: "an installer reported success but the tool never showed up, why?",
    term: "verify()",
    answer: "Kendi yazdığını geri okuyan kurulum hiçbir şey kanıtlamaz",
    answerType: "context",
  },
  {
    asked: "how are durations in the report calculated?",
    term: "task_events",
    answer: "Reports are replayed from task_events, never guessed from updated_at",
    answerType: "context",
  },
  {
    asked: "a tool returns an empty object but reports no error, what was that?",
    term: "pending promise",
    answer: "Bir aracın {} döndürmesi bağlı görünmesini engellemiyor",
    answerType: "context",
  },
  {
    asked: "is colour alone enough to show a status?",
    term: "Renkler tek başına",
    answer: "Renkler tek başına anlam taşımaz",
    answerType: "context",
  },
  {
    asked: "what should go in a commit message body?",
    term: "Conventional Commits",
    answer: "Commit messages answer why, not what",
    answerType: "context",
  },
  {
    asked: "should we rate limit logins per account or per address?",
    term: "spraying one password",
    answer: "Rate limit login attempts per IP",
    answerType: "task",
  },
  {
    asked: "why did adding an index not speed up the task list?",
    term: "33.5 ms",
    answer: "Görev listesini indeksle",
    answerType: "task",
  },
  {
    asked: "why was staleness detection always answering unknown?",
    term: "no checkout",
    answer: "Move hashing to the machine that has the files",
    answerType: "task",
  },
  {
    asked: "two dependency PRs went in and main broke, what happened?",
    term: "baseline-browser-mapping",
    answer: "Dependabot lockfile repair",
    answerType: "task",
  },
  {
    asked: "a deploy failed with a socket error, was it the disk?",
    term: "corepack",
    answer: "Fetch pnpm once, not on every install",
    answerType: "task",
  },
  {
    asked: "should the briefing truncate long notes?",
    term: "mid-sentence",
    answer: "Stop the briefing growing without bound",
    answerType: "task",
  },
  {
    asked: "why does the export refuse instead of cutting the file short?",
    term: "200,000 rows",
    answer: "Export everything an account owns",
    answerType: "task",
  },
  // The two below are the case full-text search cannot reach on its own: half
  // of what gets searched in an engineering log is an identifier, and
  // `to_tsvector` treats `setClause` and `readFileSync` as single tokens. A
  // search for the middle of one is a substring search or it is nothing, which
  // is why the ILIKE arm stays underneath the index rather than being replaced
  // by it. Remove that arm and these are the questions that stop working.
  {
    asked: "how do I build an update statement without splicing column names?",
    term: "Clause",
    answer: "Never build a SET clause by hand",
    answerType: "context",
  },
  {
    asked: "what was the risk in the server reading a caller's path?",
    term: "FileSync",
    answer: "Move hashing to the machine that has the files",
    answerType: "task",
  },
];

/**
 * Notes that answer none of the questions above, for measuring what the
 * briefing's body ceiling actually costs.
 *
 * Filler rather than duplicated corpus notes, and that distinction is the whole
 * measurement. `reportGrowth` reuses real bodies because it is weighing bytes
 * and wants realistic sizes; recall cannot, because a duplicate of the note
 * that answers a question competes with it for the same budget on identical
 * text — so the run would score a miss where the agent in fact received the
 * answer, and the number would be wrong in the direction that flatters the
 * change being tested.
 *
 * Written to be plausible and to be about a subsystem the questions never
 * mention, at roughly the length a real note runs to. `n` varies the subject so
 * a hundred of them are not one note a hundred times, which would let a single
 * relevance hit stand in for all of them.
 */
const FILLER_SUBJECTS = [
  "the invoice export worker",
  "the nightly currency sync",
  "the warehouse label printer",
  "the fleet telemetry poller",
  "the seating chart renderer",
  "the payroll rounding rules",
];

/**
 * Open tasks whose log answers none of the questions above, for measuring what
 * a byte budget on the log actually costs.
 *
 * The same argument as `filler`, one level down, and for the same reason: a
 * duplicate of the entry that answers a question would compete with it for the
 * same budget on identical text, and the run would score a miss where the agent
 * in fact received the answer.
 *
 * WRITTEN AT PRODUCTION LENGTHS, and that is the whole point of the shape
 * below. Measured on 2026-09-04 across 597 real entries: handoff p50 1,737 /
 * p90 3,419; decision p50 2,365 / p90 3,828; dead_end p50 1,443 / p90 2,702.
 * The corpus above runs to about 300 characters an entry, which is honest for
 * what it was written to measure -- whether search finds a thing -- and useless
 * for a byte curve. A budget measured against 300-character entries would come
 * out five times too small and nobody would know until a real briefing hit it.
 *
 * `n` varies the subject, so forty of these are not one task forty times: a
 * single relevance hit must not be able to stand in for all of them once the
 * budget is spent by focus rather than recency.
 */
const LOG_SUBJECTS = [
  "the shipment tracking poller",
  "the tax rate importer",
  "the seat reservation lock",
  "the document thumbnailer",
  "the supplier price feed",
  "the timesheet approval chain",
  "the returns intake queue",
  "the loyalty points ledger",
];

/** Roughly the p50 of the kind, padded with material that reads like a body. */
const para = (subject: string, n: number, sentences: number) =>
  Array.from(
    { length: sentences },
    (_, i) =>
      `${subject} keeps its ${100 + n + i} pending items in one table and the reader takes them ` +
      `in order, which matters because the order is the only thing that makes a partial run ` +
      `resumable. The obvious alternative was a queue per worker, and it was measured and ` +
      `dropped: rebalancing after a worker died moved more rows than the run itself wrote, and ` +
      `the window where two workers held the same item was wide enough to double-write ${n + i} ` +
      `times in an afternoon. What replaced it is a single claim column stamped with the worker ` +
      `id and a deadline, so a dead worker's items fall back on their own without anybody ` +
      `noticing they were ever claimed.`,
  ).join("\n\n");

export const logFiller = (n: number): Task => {
  const subject = LOG_SUBJECTS[n % LOG_SUBJECTS.length];
  return {
    title: `Batch ${n} claim handling in ${subject}`,
    body:
      `${subject} needs a claim that survives a worker dying mid-run. Done when a killed worker's ` +
      `items are picked up by another within one deadline and nothing is written twice.`,
    entries: [
      { kind: "handoff", body: para(subject, n, 3) },
      { kind: "decision", body: para(subject, n + 1, 4) },
      { kind: "decision", body: para(subject, n + 2, 3) },
      { kind: "dead_end", body: para(subject, n + 3, 3) },
      { kind: "dead_end", body: para(subject, n + 4, 2) },
    ],
  };
};

export const filler = (n: number): Note => {
  const subject = FILLER_SUBJECTS[n % FILLER_SUBJECTS.length];
  return {
    kind: (["convention", "decision", "gotcha", "preference"] as const)[n % 4],
    title: `Batch ${n} handling in ${subject}`,
    body:
      `${subject} processes its queue in batches of ${100 + n}, and the size is not arbitrary: ` +
      `below that the per-batch overhead dominates and above it a single retry replays too much ` +
      `work. The retry is at-least-once, so every handler downstream has to tolerate seeing the ` +
      `same item twice — the ledger writer does this by keying on the item's own identifier ` +
      `rather than on the position in the batch. An earlier version keyed on position and ` +
      `double-counted anything that arrived after a partial failure, which nobody noticed for ` +
      `a week because the totals were only wrong on days a batch had failed.`,
  };
};

/**
 * Questions this corpus cannot answer, for measuring what search returns when
 * the honest answer is nothing.
 *
 * Recall says whether the right row came back and is silent about how much came
 * with it. That silence hid a real defect: because a stopword in one language is
 * a content word in the other, asking `websearch_to_tsquery('turkish', …)` an
 * English question kept `why`, `is`, `on` and `a` as search terms, and every
 * document containing the word "a" matched. Recall never noticed -- the right
 * row was still in the top five -- while a question about a subject the log had
 * never heard of came back with thirty confident records.
 *
 * Deliberately about a domain nothing here touches, and phrased the way an
 * agent would ask, stopwords and all: the failure only appears in natural
 * language, which is exactly the shape the tool description asks for.
 */
export const UNANSWERABLE = [
  "how do we handle refunds for a cancelled subscription?",
  "what is the retention policy on the audio recordings?",
  "why is the mobile app asking for camera permissions?",
  "which vendor did we pick for the payroll integration?",
  "kargo firması değişince adres formatı nasıl eşleniyor?",
];
