export const en = {
  /* chrome */
  tagline: "it remembers, so you don't",
  skipToContent: "Skip to content",
  searchPlaceholder: "search everything",
  searchLabel: "Search tasks, log entries and notes",
  searchClear: "Clear search",
  languageLabel: "Language",
  breadcrumb: "Breadcrumb",
  navReport: "Report",
  navAccount: "Account",
  signIn: "Sign in",
  signUp: "Create account",
  signOut: "Sign out",

  /* auth */
  loginTitle: "Welcome back",
  loginIntro: "Sign in to reach your projects and the log behind them.",
  registerTitle: "Create your account",
  registerIntro: "Your projects, your log, your agents. Nobody else can see any of it.",
  identifier: "username or email",
  username: "username",
  email: "email",
  displayName: "name",
  password: "password",
  newPassword: "new password",
  currentPassword: "current password",
  haveAccount: "Already have an account? Sign in",
  noAccount: "No account yet? Create one",
  claimedNotice:
    "Existing local data had no owner, so it now belongs to this account.",

  err_usernameFormat: "3-32 characters: letters, numbers, - and _ only.",
  err_emailFormat: "That does not look like an email address.",
  err_nameRequired: "Tell us what to call you.",
  err_passwordShort: "At least 8 characters.",
  err_usernameTaken: "That username is taken.",
  err_emailTaken: "That email is already registered.",
  err_badCredentials: "Those details do not match an account.",
  err_tooManyAttempts: "Too many attempts. Try again in about {n} minutes.",
  err_linkInvalid: "That link has expired or has already been used.",

  /* recovery */
  forgotLink: "Forgot your password?",
  forgotTitle: "Reset your password",
  forgotIntro:
    "Give us the address on the account and we will send a link. It works once and expires in an hour.",
  forgotSend: "send the link",
  forgotSent: "If that address has an account, the link is on its way.",
  forgotSentNote: "Check the spam folder before trying again.",
  backToLogin: "Back to sign in",
  resetTitle: "Choose a new password",
  resetIntro: "Setting it here signs out every other session.",
  resetSubmit: "set password",
  resetNoToken: "This page needs a reset link. Request a new one.",

  /* verification */
  verifyTitle: "Email confirmed",
  verifyOk: "Thanks — your address is verified.",
  verifyFailedTitle: "That link did not work",
  verifyFailed:
    "It has expired or was already used. Sign in and send yourself a new one.",
  verifyPending: "Your email is not verified yet.",
  verifyPendingNote:
    "Everything works, but public share links stay disabled until it is.",
  verifyResend: "send the link again",
  verifyVerified: "verified",
  verifyBlockedShare:
    "Verify your email address before creating a public link for this project.",
  continueToApp: "Continue",

  /* account */
  accountTitle: "Account",
  profile: "Profile",
  changePassword: "Change password",
  changePasswordNote: "Changing it signs you out everywhere.",
  apiTokens: "Agent tokens",
  apiTokensIntro:
    "The MCP server signs in with one of these. Create one, paste it into the command below, and the agent reaches your account and nothing else.",
  tokenName: "what is it for",
  createToken: "create token",
  revoke: "revoke",
  tokenOnce: "Copy it now — it is never shown again.",
  neverUsed: "never used",
  lastUsed: "last used",
  noTokens: "No tokens yet.",

  /* generic */
  add: "add",
  save: "save",
  create: "create",
  delete: "delete",
  link: "link",
  unlink: "unlink",
  rehash: "re-hash",
  append: "append",
  apply: "apply",
  title: "title",
  optional: "optional",
  none: "none",

  /* home */
  heroTitle: "A memory for you and your agents",
  heroBody:
    "todox is not a checklist. Each task carries a log — the decisions behind it, the approaches that failed, the questions still open, and the note the last session left behind. A fresh Claude reads it with one get_context call and continues without asking you anything.",
  step1Title: "It gets written down",
  step1Body:
    "Mostly by the agent, while it works: what it decided, what it tried that failed, what it needs you to answer.",
  step2Title: "It stays put",
  step2Body:
    "In one database outside your repos. Branches, worktrees and fresh clones can't lose it, and it never lands in git.",
  step3Title: "The next session reads it",
  step3Body:
    "One get_context call and a cold agent knows what the last one knew — including which walls not to walk into again.",
  kindsSummary: "what actually goes in a log — the five kinds",
  projects: "Projects",
  newProject: "+ new project",
  projectNamePh: "name",
  projectPathPh: "/absolute/path/to/repo (optional)",
  projectSummaryPh: "what is this project? written for a cold agent",
  globalContext: "Global context",
  globalContextSub: "— true in every project",
  globalEmpty:
    "Nothing yet. This is where cross-project knowledge lives: standing preferences, decisions that bind every repo, traps you keep falling into.",
  addGlobalNote: "+ add global note",
  noteBodyPh: "the note itself",
  hookTitle: "Hook it up to Claude",
  hookBody:
    "Create an agent token, paste the command it gives you, and the agent reads and writes this log by itself.",
  hookCta: "go to Account →",
  firstRunTitle: "Nothing here yet",
  firstRunBody:
    "Add your first project below — name it and point it at a repo path. After that, hook todox up to Claude and let the agent do the writing.",
  countInFlight: "in flight",
  countStuck: "stuck",
  countQueued: "queued",
  countDone: "done",

  /* project page */
  inFlight: "In flight",
  stuck: "Stuck",
  queued: "Queued",
  doneDropped: "Done & dropped",
  nothingInFlight: "Nothing in flight.",
  nothingStuck: "Nothing stuck.",
  emptyQueue: "Empty queue. Suspicious.",
  projectContext: "Project context",
  projectContextEmpty: "Decisions, conventions and gotchas that outlive any one task.",
  moveAlong: "Move things along",
  allClear: "All clear.",
  newTask: "+ new task",
  taskTitlePh: "title",
  taskBodyPh: "goal, constraints, definition of done",
  p1: "p1 high",
  p2: "p2 normal",
  p3: "p3 low",
  staleTitleOne: "1 note may be lying to you",
  staleTitleMany: "{n} notes may be lying to you",
  staleBody:
    "The files behind these have changed since they were written. Stale context is worse than none.",
  inLog: "in log",
  deadEndCount: "dead end",
  deadEndCountPlural: "dead ends",
  askedCount: "asked",
  statusLabel: "Status",
  priorityLabel: "Priority",

  /* sharing */
  sharing: "Sharing",
  shareOff: "This project is private. Only you can see it.",
  shareOn: "Anyone with this link can read the task list.",
  shareEnable: "create a public link",
  shareDisable: "stop sharing",
  shareRotate: "new link",
  shareIncludeLog: "include the log (decisions, dead ends, handoffs)",
  shareCopy: "copy link",
  shareCopied: "copied",
  shareScopeNote:
    "Linked file paths and project context are never shared, whatever you pick here.",
  shareReachNote:
    "The link only works for people who can reach this server — on localhost that means you.",
  sharedReadOnly: "Read-only shared view",
  sharedIntro: "A public snapshot of this project's task list.",
  sharedNoLog: "The log is not part of this share.",

  /* task page */
  task: "task",
  theLog: "The log",
  logEmpty:
    "Empty. This is the part that matters: decisions, dead ends, open questions, and the handoff the next session reads first.",
  filesInPlay: "Files in play",
  filesHint:
    "Files are fingerprinted when you link them. If one changes later, every note on this task gets flagged — so the agent never trusts a description of code that has moved on.",
  filesEmpty:
    "Link the files this task touches. todox hashes them now and tells you later when a note has gone stale.",
  filePathPh: "/absolute/path/...",
  fileNotePh: "why this file matters (optional)",
  whatAgentSees: "What the agent sees",
  agentSeesBody:
    "hands over this task with its decisions, dead ends, open questions and the last handoff — plus a warning for every linked file that changed since it was noted.",
  updated: "updated",
  linkedAt: "linked",
  by: "by",

  /* search */
  searchTitle: "Search",
  searchIntro:
    "Every project at once — tasks, log entries, context notes. This is the answer to “have I already solved this somewhere?”",
  searchNoResults: "Nothing matched.",
  searchPrompt: "Type a query up top.",
  resultsCount: "results",

  /* report */
  reportTitle: "What got done",
  reportIntro:
    "Straight from the log, not reconstructed from commits: what you finished, how long it took, which model did the work, and what it was worth.",
  periodToday: "Today",
  periodYesterday: "Yesterday",
  periodWeek: "This week",
  periodLastWeek: "Last week",
  periodMonth: "This month",
  periodAll: "All time",
  generatedAt: "generated",
  totalsCreated: "created",
  totalsCompleted: "completed",
  totalsDropped: "dropped",
  totalsTouched: "touched",
  totalsEntries: "log entries",
  totalsActive: "time in flight",
  byProject: "By project",
  byModel: "By model",
  completedTasks: "Completed",
  inProgressTasks: "Still open",
  decisionsMade: "Decisions made",
  deadEndsHit: "Dead ends hit",
  questionsRaised: "Questions raised",
  noActivity: "Nothing happened in this window.",
  leadTime: "start to finish",
  activeTime: "worked",
  importance: "importance",
  imp_high: "high",
  imp_normal: "normal",
  imp_low: "low",
  modelLabel: "model",
  notStarted: "never started",
  partialNote:
    "Timings marked ~ predate transition tracking and are a lower bound, not a measurement.",
  copyReport: "copy as markdown",
  reportCopied: "copied",
  reportForManager: "The markdown copy is written to be pasted straight into an update.",

  /* durations */
  durDays: "{n}d",
  durHours: "{n}h",
  durMinutes: "{n}m",
  durNone: "—",

  /* statuses */
  st_todo: "todo",
  st_doing: "doing",
  st_blocked: "blocked",
  st_done: "done",
  st_dropped: "dropped",

  /* ref freshness */
  ref_fresh: "fresh",
  ref_changed: "moved on!",
  ref_missing: "gone!",
  ref_unknown: "unreadable",

  /* entry kinds */
  k_note: "note",
  k_decision: "decision",
  k_dead_end: "dead end",
  k_question: "question",
  k_handoff: "handoff",
  kh_note: "Worth remembering, but not a decision.",
  kh_decision: "What you chose — and why the alternatives lost.",
  kh_dead_end:
    "An approach that did NOT work. The most valuable thing here: it stops the next session hitting the same wall.",
  kh_question: "Something only a human can answer. Surfaced instead of guessed.",
  kh_handoff: "End-of-session state, written so a stranger could continue.",
  kp_note: "just so it's written down…",
  kp_decision: "chose X over Y because…",
  kp_dead_end: "tried X — didn't work because Y. Don't retry it.",
  kp_question: "should we…?",
  kp_handoff: "done so far: … / next step: … / watch out for: …",

  /* context kinds */
  c_decision: "decision",
  c_convention: "convention",
  c_gotcha: "gotcha",
  c_preference: "preference",

  /* relative time */
  justNow: "just now",
  minutesAgo: "{n}m ago",
  hoursAgo: "{n}h ago",
  daysAgo: "{n}d ago",
} as const;

export type Key = keyof typeof en;
