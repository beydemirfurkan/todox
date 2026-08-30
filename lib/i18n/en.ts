export const en = {
  /* chrome */
  tagline: "it remembers, so you don't",
  siteName: "todox",
  metaTitleHome: "todox — working memory for developers and their agents",
  metaTitleLogin: "Sign in — todox",
  metaTitleRegister: "Create your account — todox",
  metaTitleForgot: "Reset your password — todox",
  metaTitleAbout: "About todox — working memory for developers and their agents",
  metaTitlePrivacy: "Privacy policy — todox",
  metaTitleContact: "Contact todox",
  /* Signed-in pages. Noindex, so there is no description to go with these —
     the title is for the browser tab, where several projects are usually open
     at once and every one of them read "todox" before. */
  metaTitleAccount: "Account — todox",
  metaTitleReport: "Activity report — todox",
  metaTitleSearch: "Search — todox",
  metaDescription:
    "todox is a working memory for developers and their coding agents: projects, tasks, and the log that survives every session.",
  metaDescriptionLogin:
    "Sign in to todox to reach your projects, tasks and the log that survives every coding session.",
  metaDescriptionRegister:
    "Create a free todox account to keep your projects, task log and coding-agent context in one place. Nobody else can see any of it.",
  metaDescriptionForgot:
    "Reset your todox account password in one step. We email a link that works once and expires in an hour, with no login required.",
  metaDescriptionAbout:
    "todox is a small open-source workspace for a developer and their coding agents: projects, tasks, and a session log that survives every handoff.",
  metaDescriptionPrivacy:
    "Read the todox privacy policy: what we collect, why, how long we keep it, and how to ask for your data to be deleted.",
  metaDescriptionContact:
    "Get in touch with the todox team — GitHub issues for bugs and ideas, security disclosures, and the repo behind the project.",
  footerAbout: "About",
  footerPrivacy: "Privacy",
  footerContact: "Contact",
  whatItIs: "What it is",
  whatItIs1: "A project per repository, with the tasks you are working on and the log entries that explain what happened to them.",
  whatItIs2: "A live log per task: doing, blocked, done. Each change is a row, not an edit, so the history is the source of truth.",
  whatItIs3: "A daily and weekly activity report written for whoever is starting their day — the developer or the agent they are about to hand off to.",
  whatItIs4: "An MCP server (/api/mcp) that exposes the same surface to coding agents. The hosted endpoint and the stdio process share one tool list.",
  whatItIsNot: "What it is not",
  whatItIsNot1: "A kanban board. There is no swimlane, no sprint, no Gantt.",
  whatItIsNot2: "A team chat. Comments live next to the change they describe.",
  whatItIsNot3: "A wiki. Notes are short and dated.",
  builtBy: "Built by",
  builtByBody:
    "todox is built and maintained by Furkan Beydemir. The repository is open source under the MIT license, and contributions are welcome on GitHub.",
  forAgents: "Are you an agent? Read /llms.txt.",
  privacyLastUpdated: "Last updated: 12 August 2026.",
  privacyWhatWeStore: "What we store",
  privacyStore1: "Your account: email, username, display name, and a password hash. The hash is scrypt and we cannot read your password.",
  privacyStore2: "Your projects, tasks, log entries, context notes, and project memberships — the data you put into todox.",
  privacyStore3: "Session cookies that keep you signed in. They are HTTP-only, signed, and expire when you sign out or after 30 days of inactivity.",
  privacyStore4: "Server logs with your IP address and request path, kept for 30 days for abuse detection and debugging.",
  privacyWhatWeDoNot: "What we do not do",
  privacyDoNot1: "We do not run third-party analytics, ad networks, or tracking pixels in the app.",
  privacyDoNot2: "We do not sell or share your data with marketers, data brokers, or social networks.",
  privacyDoNot3: "We do not train AI models on your projects, tasks or notes.",
  privacySubprocessors: "Sub-processors",
  privacySubprocessorsBody:
    "todox itself is the only processor of your data. We use a small set of infrastructure sub-processors to run the service:",
  privacySub1: "Hostinger — a virtual server in Frankfurt, Germany. The application and the PostgreSQL database both run on it, so your projects, tasks and notes stay on that one machine.",
  privacySub2: "Resend — transactional email for verification and password reset. Only the recipient address and the message itself are handed over, and Resend processes them in its Tokyo (ap-northeast-1) region.",
  privacyRetention: "How long we keep your data",
  privacyRetentionBody:
    "We keep your account and your projects for as long as the account exists. Deleting your account deletes your projects, tasks, log entries, and notes; session records are removed within 30 days. Server logs are deleted after 30 days.",
  privacyYourRights: "Your rights",
  privacyYourRightsBody:
    "You can export your data and delete your account from the Account page. To exercise rights that are not covered by the UI — for example, a data access request on behalf of someone else — open a GitHub issue.",
  privacyChanges: "Changes to this policy",
  privacyChangesBody:
    "When this policy changes in a way that affects what we collect or how we use it, the change is announced in the GitHub release notes before it takes effect.",
  contactIntro:
    "Most of the conversation around todox happens in public, on GitHub. Pick the channel that matches what you need.",
  contactBugs: "Bugs and feature ideas",
  contactBugsBody: "Open an issue on GitHub:",
  contactSecurity: "Security disclosures",
  contactSecurityBody:
    "Please see SECURITY.md in the repository for the disclosure process. Do not open a public issue for a vulnerability you have not reported yet.",
  contactCode: "The code",
  contactCodeBody: "todox is open source at",
  skipToContent: "Skip to content",
  searchPlaceholder: "search everything",
  searchLabel: "Search tasks, log entries and notes",
  searchClear: "Clear search",
  languageLabel: "Language",
  langSwitching: "switching language…",
  breadcrumb: "Breadcrumb",
  navReport: "Report",
  notifications: "Notifications",
  notificationsLabel: "Notifications, {n} unread",
  notificationsNone: "Nothing new.",
  markAllRead: "mark all read",
  someone: "Someone",
  aProject: "a project",
  notifInviteReceived: "{who} invited you to {project}.",
  notifInviteAccepted: "{who} joined {project}.",
  notifMemberRemoved: "You no longer have access to {project}.",

  navAccount: "Account",
  signIn: "Sign in",
  signUp: "Create account",
  signOut: "Sign out",

  /* auth */
  loginTitle: "Welcome back",
  mascotShy: "not looking",
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
  err_usernameFormat: "3-32 characters: letters, numbers, - and _ only.",
  err_emailFormat: "That does not look like an email address.",
  err_nameRequired: "Tell us what to call you.",
  err_passwordShort: "At least 8 characters.",
  err_usernameTaken: "That username is taken.",
  err_emailTaken: "That email is already registered.",
  err_badCredentials: "Those details do not match an account.",
  err_tooManyAttempts: "Too many attempts. Try again in about {n} minutes.",
  err_linkInvalid: "That link has expired or has already been used.",
  err_confirmMismatch: "That is not your username.",

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
  profileSaved: "Saved.",
  changeEmail: "Change email",
  changeEmailNote:
    "Your password, because this is how an account gets taken over. The new address has to confirm itself, and the old one is told what happened.",
  changeEmailSent: "Changed. Check the new address for the confirmation link.",
  changePassword: "Change password",
  changePasswordNote:
    "Signs you out everywhere. Agent tokens keep working — revoke them below if one of those is the problem.",
  apiTokens: "Agent tokens",
  invites: "Invites",
  viewInvites: "View invites",
  pendingInvites: "Pending invites",
  joinedProjects: "Joined projects",
  noInvites: "No pending invitations.",
  noJoinedProjects: "You have not joined another person's project yet.",
  acceptInvite: "accept invite",
  inviteTitle: "Project invitation",
  inviteDescription: "You have been invited to collaborate on {project}.",
  inviteEmailMismatch: "Sign in with the email address that received this invitation.",
  inviteInvalidTitle: "This invitation is no longer available",
  inviteInvalidBody: "It may have expired, been revoked, or already been accepted.",
  apiTokensIntro:
    "An agent signs in with one of these. Create one and you get setup text you can paste straight into whichever agent you use; it reaches your account and nothing else.",
  tokenName: "what is it for",
  createToken: "create token",
  tokenCreating: "creating…",
  revoke: "revoke",
  revokeAll: "revoke every token",
  revokeAllNote:
    "Tokens do not expire and each one carries the whole account. If you think one has leaked and cannot tell which, end all of them.",
  tokenOnce: "Copy it now — it is never shown again.",
  tokenTooMany:
    "That is a lot of tokens for one day. Try again in about {n} minutes — or revoke the ones you are no longer using, below.",
  setupPromptTitle: "Paste this to your agent",
  setupPromptTemplate: [
    "Add todox as an MCP server. It is a remote (HTTP) server, so there is",
    "nothing to install:",
    "",
    "  name   : todox",
    "  type   : http (streamable-http)",
    "  url    : {url}",
    "  header : Authorization: Bearer {token}",
    "",
    "Add it at USER / GLOBAL scope, not for this project only — todox is the",
    "memory across every repository I work in, and a per-project install is a",
    "memory with amnesia everywhere else. Claude Code: `claude mcp add --scope",
    "user --transport http`. Codex: ~/.codex/config.toml. Cursor: the",
    "~/.cursor/mcp.json in my home directory. VS Code: the user-level mcp.json",
    "(“MCP: Open User Configuration”), where the root key is `servers`.",
    "",
    "Then add these four lines to the memory file you actually obey — the one",
    "you read in EVERY project, not a file inside this repository. Claude Code:",
    "~/.claude/CLAUDE.md. Codex: ~/.codex/AGENTS.md. Cursor: ~/.cursor/rules/.",
    "VS Code: ~/.copilot/instructions/. OpenCode: ~/.config/opencode/AGENTS.md.",
    "An MCP server's own instructions are background reading and lose to",
    "anything written there, which is why a connected todox still gets skipped:",
    "",
    "  - call get_context before starting non-trivial work (cwd = the",
    "    directory you are in); it registers a new repo by itself",
    "  - create_task for anything that will not finish this session",
    "  - log_entry(kind:'handoff') on every task you touched before you stop,",
    "    and dead_end for approaches that failed",
    "  - always pass your own model id",
    "",
    "Then call get_context with the absolute path of this directory and tell",
    "me what it found.",
  ].join("\n"),
  setupPromptWarning:
    "This text carries your token, so it ends up in that agent's transcript. Revoke it below if that is not what you want.",
  setupManualTitle: "Or add it by hand",
  setupScopeNote:
    "Every path below is the global one. These tools all default to the project you are standing in, which would give you a memory that works in one folder.",
  setupAgentLabel: "Choose your agent",
  setupAgentOther: "other",
  setupVerify:
    "Once it connects, have the agent call get_context. That is how you know it worked.",
  copySnippet: "copy",
  neverUsed: "never used",
  lastUsed: "last used",
  noTokens: "No tokens yet.",
  tokenColumnName: "Token",
  tokenColumnActivity: "Activity",
  tokenColumnCreated: "Created",
  tokenColumnActions: "Actions",
  exportTitle: "Export your data",
  exportBody:
    "Every project you own, with its tasks, log, context notes and linked-file hashes, as one JSON file. Nothing about anybody else: projects shared with you belong to whoever made them, and no collaborator, invitation or credential is in the file.",
  exportCta: "Download my data",
  deleteAccount: "Delete account",
  deleteAccountNote:
    "Ends the account and takes every project, task and log entry with it. There is no copy and no undo — export anything you want to keep first.",
  deleteAccountConfirm: "type your username to confirm",
  deleteAccountSubmit: "delete my account",

  /* generic */
  add: "add",
  save: "save",
  /* what a button says while its action is in flight */
  working: "working…",
  saving: "saving…",
  signingIn: "signing in…",
  signingUp: "creating…",
  sendingLink: "sending…",
  create: "create",
  delete: "delete",
  close: "close",
  link: "link",
  unlink: "unlink",
  acceptRef: "accept as current",
  checkedAt: "checked",
  neverChecked: "not checked by an agent yet",
  append: "append",
  apply: "apply",
  title: "title",
  none: "none",

  /* home */
  heroTitle: "A memory for you and your agents",
  heroBody:
    "todox is not a checklist. Each task carries a log — the decisions behind it, the approaches that failed, the questions still open, and the note the last session left behind. A fresh agent reads it with one get_context call and continues without asking you anything.",
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
  hookTitle: "Hook up your agent",
  hookBody:
    "Create an agent token and paste the setup text into your agent — Claude Code, Codex, Cursor, VS Code, anything that speaks MCP. After that it reads and writes this log by itself.",
  hookCta: "go to Account →",
  firstRunTitle: "Nothing here yet",
  firstRunBody:
    "Add your first project below — name it and point it at a repo path. After that, hook todox up to your agent and let it do the writing.",
  countInFlight: "in flight",
  countStuck: "stuck",
  countQueued: "queued",
  countDone: "done",

  /* project page */
  inFlight: "In flight",
  stuck: "Stuck",
  queued: "Queued",
  doneDropped: "Done & dropped",
  projectContext: "Project context",
  projectContextEmpty: "Decisions, conventions and gotchas that outlive any one task.",
  tabLog: "Log",
  tabFiles: "Files",
  taskSections: "Task sections",
  filePathLabel: "file path",
  projectPathLabel: "repo path on this machine",
  projectDetails: "Details",
  projectNameLabel: "name",
  projectSummaryLabel: "summary",
  projectRepoLabel: "git remote",
  projectRepoPh: "git@github.com:you/repo.git (optional)",
  projectRepoNote:
    "How todox recognises this repo on another machine. Without it, opening the same project on a second computer registers a duplicate and the history splits in two.",
  allClear: "All clear.",
  tasks: "tasks",
  taskFilterLabel: "Filter by status",
  filterOpen: "open",
  noTasksHere: "Nothing with this status.",
  andMore: "{n} more, not shown. Narrow it with the filters above.",
  projectSettings: "Project settings",
  team: "Team",
  teamOwner: "owner",
  teamYou: "you",
  teamPending: "Invited, not joined yet",
  teamAlone: "Only you. Invite somebody from project settings.",
  sharedBy: "{name}'s project",
  memberCount: "{n} people",
  invitePeople: "Invite by email",
  inviteEmail: "Email address",
  inviteSend: "send invitation",
  pending: "Pending",
  removeCollaborator: "remove",
  localPathLabel: "on this machine",
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
  staleAndMore: "and {n} more, listed on the tasks themselves.",
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
  sharedAndMore: "{n} more, not shown. A share is a snapshot, not the whole project.",
  sharedBusyTitle: "Too many requests",
  sharedBusyBody:
    "This link has been opened a lot from your address in the last few minutes. Try again in about {n} minutes — nothing is wrong with the project.",

  /* task page */
  task: "task",
  theLog: "The log",
  logEmpty:
    "Empty. This is the part that matters: decisions, dead ends, open questions, and the handoff the next session reads first.",
  filesInPlay: "Files in play",
  filesHint:
    "Files are fingerprinted by the agent, which is the side that can actually see them. When one changes, every note on this task gets flagged — so nobody trusts a description of code that has moved on.",
  filesEmpty:
    "Link the files this task touches. The next agent to read this task checks them and says whether a note has gone stale.",
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
    "Every project at once — tasks, log entries, context notes. Ask it in words and the closest answer comes first; put quotes around a phrase to require it exactly.",
  searchNoResults: "Nothing matched. Try fewer words, or a term you know appears in what you are after.",
  searchPrompt: "Type a query up top.",
  resultsCount: "results",
  hit_task: "task",
  hit_entry: "log",
  hit_context: "note",
  globalScope: "all projects",

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
  totalsCreated: "created",
  totalsCompleted: "completed",
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
  approxWhy:
    "approximate — this task was backfilled, or it closed without ever being marked in flight, so the time worked is not a measurement",
  importance: "importance",
  imp_high: "high",
  imp_normal: "normal",
  imp_low: "low",
  modelLabel: "model",
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
  ref_unknown: "unchecked",

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

  deleteProject: "Delete this project",
  deleteProjectNote:
    "Removes the project and everything in it: {n} tasks with their whole log, the notes and the file links. There is no undo — download your data from the Account page first if you want to keep any of it.",
  deleteProjectConfirm: "Type {slug} to confirm",
  deleteProjectSubmit: "Delete it and everything in it",

  /* the page a visitor who is not signed in sees */
  landingLede:
    "Your agent starts every session knowing nothing about the last one. You pay for that twice — once explaining the project again, and once when it walks into a wall a previous session already found.",
  landingCta: "Create an account",
  landingSecondary: "I already have one",
  landingConnectTitle: "Works with the agent you already use",
  landingConnectBody:
    "One URL and a token. No package to install, no local process to keep running — anything that speaks MCP can connect: Claude Code, Codex, Cursor, VS Code.",
  /* the three claims the product actually makes, and the payload behind them */
  diffTitle: "Why the log is worth trusting",
  diff1Title: "Dead ends are a kind of entry",
  diff1Body:
    "Most notes record what worked. The expensive knowledge is what did not: the approach that looked right, cost an afternoon and failed for a reason nobody writes down. That one has its own kind here, because it is the entry that stops the next session repeating it.",
  diff2Title: "A stale note says so",
  diff2Body:
    "Every linked file is hashed by the side that can see it — your agent — and checked again later. When the code moves on, the note is flagged as possibly lying. Until somebody has actually looked, it says \"not checked\" rather than claiming to be fresh: context that lies is worse than none, and that includes lying about how sure it is.",
  diff3Title: "The report is a query, not archaeology",
  diff3Body:
    "Every status change is an event, so what got finished today, how long it took and which model did it are read from the log rather than reconstructed from commits.",
  briefingTitle: "What your agent reads, in one call",
  briefingBody:
    "This is the shape of `get_context` — the first call every session makes. Not a summary of the product: the payload.",
  briefingCaption: "Trimmed for width. The real one carries every open task.",

  landingOpenSource: "Open source, MIT. Read the code, or run your own.",
  landingHonest:
    "Free, and hosted on one small server. Nothing here is locked in: the whole thing is MIT, so if the log matters to you, run it yourself.",

  verifyConfirmTitle: "One click to go",
  verifyConfirmBody:
    "Confirm this address is yours. The link is spent when you press the button, not when the page opens.",
  verifyConfirmCta: "Verify my email",

  /* when a page cannot be shown */
  errorTitle: "That did not work",
  errorBody:
    "Something on the server went wrong on the way to this page. Nothing you were looking at has been lost.",
  errorRetry: "Try again",
  notFoundTitle: "Nothing here",
  notFoundBody:
    "This page does not exist, or the project it pointed at has been renamed or deleted.",
  backHome: "Back to your projects",

  /* relative time */
  justNow: "just now",
  minutesAgo: "{n}m ago",
  hoursAgo: "{n}h ago",
  daysAgo: "{n}d ago",
} as const;

export type Key = keyof typeof en;
