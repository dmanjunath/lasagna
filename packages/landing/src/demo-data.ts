/**
 * Every figure shown in a landing page illustration.
 *
 * All of it is invented. None of it comes from a real account, from the app's
 * seed data, or from any tenant. The household below is a composite built to
 * sit near US medians: roughly $82k household income, a home carrying most of
 * the net worth, a mid-four-figure card balance at a typical APR, and a
 * retirement balance behind where it needs to be.
 *
 * Institution names are invented too. Using real brands would imply a
 * relationship that does not exist.
 *
 * If you add a figure to an illustration, add it here.
 */

export const HOUSEHOLD = {
  netWorth: "$155,300",
  assets: "$424,000",
  debts: "$268,700",
  takeHome: "$5,140",
};

export const INSTITUTIONS = [
  {
    initial: "L", color: "var(--accent-ink)", name: "Lakeside Bank",
    meta: "Checking and savings", total: "$12,600",
    accounts: [
      { name: "Everyday Checking", kind: "Checking", bal: "$3,150", neg: false },
      { name: "Savings", kind: "4.50% a year", bal: "$9,450", neg: false },
    ],
  },
  {
    initial: "M", color: "var(--brand-ink)", name: "Meridian Invest",
    meta: "Retirement and brokerage", total: "$71,400",
    accounts: [
      { name: "401(k)", kind: "Employer plan", bal: "$58,200", neg: false },
      { name: "Roth IRA", kind: "Retirement", bal: "$13,200", neg: false },
    ],
  },
  {
    initial: "N", color: "var(--negative)", name: "Northgate Credit Union",
    meta: "Card and auto loan", total: "-$20,700",
    accounts: [
      { name: "Rewards Card", kind: "22.9% a year", bal: "-$5,800", neg: true },
      { name: "Auto Loan", kind: "7.20% a year", bal: "-$14,900", neg: true },
    ],
  },
];

export const RECORD = [
  { k: "name", value: "Dana Whitfield", token: "user_0xA2", id: true },
  { k: "bank", value: "Lakeside Bank", token: "removed", id: true },
  { k: "account", value: "4417", token: "acct_01", id: true },
  { k: "balance", value: "$9,450" },
  { k: "savings rate", value: "15.2%" },
];

export const ACTIONS = [
  {
    f: "Debt", cat: "c-debt", icon: "card" as const,
    title: "Pay off the $5,800 card balance",
    sub: "It charges 22.9% a year, which is $111 a month.",
    worth: "$1,330 a year",
    detail:
      "Paying this off is a sure 22.9% return. Nothing you can safely invest in beats that, so clear it before anything else.",
    evidence: { name: "Rewards Card", meta: "22.9% a year, $111 a month in interest", amt: "-$5,800", neg: true },
    cta: "See your card transactions",
  },
  {
    f: "Savings", cat: "c-save", icon: "wallet" as const,
    title: "Raise your 401(k) to catch the full match",
    sub: "You put in 3%. Your employer matches up to 5%.",
    worth: "$1,640 a year",
    detail:
      "Your employer pays in up to 5% of salary but only matches what you contribute. At 3% you are leaving $1,640 a year on the table.",
    evidence: { name: "401(k)", meta: "3% of salary, match available to 5%", amt: "$58,200", neg: false },
    cta: "Open your 401(k)",
  },
  {
    f: "Savings", cat: "c-save", icon: "wallet" as const,
    title: "Move $6,000 of idle cash to 4.5% savings",
    sub: "It earns 0.01% a year in checking.",
    worth: "$270 a year",
    detail:
      "This is cash sitting above your one-month buffer in checking. A savings account at 4.5% pays about $270 a year on it.",
    evidence: { name: "Everyday Checking", meta: "0.01% a year, $6,000 above your buffer", amt: "$3,150", neg: false },
    cta: "See your cash",
  },
];

export const TAX_ACTIONS = [
  { title: "Raise your HSA to the $8,550 family limit", chip: "$5,200 of room left" },
  { title: "Fix your W-4, you over-withheld last year", chip: "$2,180 back" },
];

export const CHATS = [
  {
    q: "I have $3,000 saved up. Should I pay off my card or build my emergency fund?",
    lead: "Split it. Your card charges <b>22.9% a year</b> and your savings pays <b>4.50%</b>, so clear most of the card but keep a buffer.",
    rows: [
      ["$2,000 off the card at 22.9%", "+$458 a year", false],
      ["$1,000 left in savings at 4.50%", "+$45 a year", false],
    ],
    total: ["What the split is worth", "+$503 a year"],
  },
  {
    q: "Can I afford a $28,000 car?",
    lead: "Not comfortably yet. The payment takes <b>11% of your take-home</b>, and the card is still running alongside it.",
    rows: [
      ["Left after your fixed costs", "$760 a month", false],
      ["Loan at 7.2% over 5 years", "-$558 a month", true],
    ],
    total: ["Left each month once the car is paid", "$202 a month"],
  },
];

export const RANGES = [
  { label: "1M", figure: "$155,300", delta: "Up $1,840", sub: "Across 6 connected accounts.", segs: [3, 17, 80],
    line: [42, 40, 38, 36, 33, 30, 28, 24, 22, 18, 14, 10] },
  { label: "1Y", figure: "$155,300", delta: "Up $16,700", sub: "Up from $138,600 a year ago.", segs: [4, 15, 81],
    line: [58, 55, 57, 50, 46, 44, 39, 34, 30, 25, 18, 10] },
  { label: "All", figure: "$155,300", delta: "Up $93,900", sub: "Up from $61,400 when you started.", segs: [6, 11, 83],
    line: [78, 74, 70, 66, 59, 54, 47, 41, 34, 26, 17, 10] },
];
