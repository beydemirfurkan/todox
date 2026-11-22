/**
 * The sample repositories the lab personas work in.
 *
 * Each one is small enough for an agent to read in a minute and real enough
 * to have a bug worth finding and a feature worth starting: the bug is what
 * session one is about, the feature is what has to survive into session two.
 * Zero dependencies everywhere -- `node --test`, `go test`, `python3 -m
 * unittest` -- so an agent never spends a session waiting on an install.
 */
export type Fixture = Record<string, string>;

const invoicely: Fixture = {
  ".gitignore": "node_modules/\n",
  "README.md": `# invoicely

Invoices for freelancers. A tiny HTTP API; the web app talks to it.

- \`npm test\` runs the tests (node:test, no dependencies).
- \`node src/server.js\` serves on :4010.

## Money
Amounts are integer kuruş (1 TL = 100). VAT is charged on the invoice
subtotal, not line by line: the total a customer sees must equal
subtotal + round(subtotal * rate).
`,
  "package.json": `{
  "name": "invoicely",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test", "start": "node src/server.js" }
}
`,
  "src/invoice.js": `/** Totals for an invoice. Amounts are integer kuruş. */
export function computeTotals(lines, taxRate) {
  let subtotal = 0;
  let tax = 0;
  for (const line of lines) {
    const amount = line.unitPrice * line.quantity;
    subtotal += amount;
    tax += Math.round(amount * taxRate);
  }
  return { subtotal, tax, total: subtotal + tax };
}

export function formatTL(kurus) {
  return (kurus / 100).toFixed(2).replace(".", ",") + " TL";
}
`,
  "src/server.js": `import { createServer } from "node:http";
import { computeTotals } from "./invoice.js";

const invoices = [];

export const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/invoices") {
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    const totals = computeTotals(input.lines, input.taxRate ?? 0.2);
    const invoice = { id: invoices.length + 1, customer: input.customer, lines: input.lines, ...totals };
    invoices.push(invoice);
    res.writeHead(201, { "content-type": "application/json" });
    return res.end(JSON.stringify(invoice));
  }
  if (req.method === "GET" && req.url === "/invoices") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(invoices));
  }
  res.writeHead(404).end();
});

if (import.meta.url === \`file://\${process.argv[1]}\`) server.listen(4010);
`,
  "test/invoice.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotals, formatTL } from "../src/invoice.js";

test("one line", () => {
  assert.deepEqual(computeTotals([{ unitPrice: 10000, quantity: 1 }], 0.2), {
    subtotal: 10000,
    tax: 2000,
    total: 12000,
  });
});

test("formats lira", () => {
  assert.equal(formatTL(129990), "1299,90 TL");
});
`,
};

const invoicelyMobile: Fixture = {
  ".gitignore": "node_modules/\n",
  "README.md": `# invoicely-mobile

The phone app's logic, kept apart from the UI so it can be tested without a
simulator. Offline first: actions queue up and sync when the network is back.

- \`npm test\`
- Talks to the invoicely API (see that repo for the invoice shape).
`,
  "package.json": `{
  "name": "invoicely-mobile",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test" }
}
`,
  "src/sync-queue.js": `/**
 * Sends queued actions in order. An action that fails stays at the head of the
 * queue and is tried again on the next run.
 */
export async function flush(queue, send) {
  const done = [];
  while (queue.length > 0) {
    const action = queue[0];
    try {
      await send(action);
      done.push(queue.shift());
    } catch {
      action.attempts = (action.attempts ?? 0) + 1;
      continue;
    }
  }
  return done;
}
`,
  "src/invoice-view.js": `/** What the invoice screen shows. Amounts are integer kuruş. */
export function invoiceRows(invoice) {
  return [
    ["Ara toplam", invoice.subtotal],
    ["KDV", invoice.tax],
    ["Toplam", invoice.total],
  ];
}
`,
  "test/sync-queue.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { flush } from "../src/sync-queue.js";

test("sends everything in order", async () => {
  const sent = [];
  await flush([{ id: 1 }, { id: 2 }], async (a) => sent.push(a.id));
  assert.deepEqual(sent, [1, 2]);
});
`,
};

const ledgerApi: Fixture = {
  "README.md": `# ledger-api

Double-entry ledger for the payments team. Every transfer moves money between
two accounts; the sum of all balances never changes.

- \`go test ./...\` (add \`-race\` when touching transfers)
- \`go run .\` serves on :4020

Clients retry on timeouts, so the same transfer request can arrive twice.
`,
  "go.mod": `module ledger

go 1.22
`,
  "ledger.go": `package main

import "errors"

var ErrInsufficient = errors.New("insufficient funds")

type Ledger struct {
	balances map[string]int64
}

func NewLedger() *Ledger {
	return &Ledger{balances: map[string]int64{}}
}

func (l *Ledger) Deposit(account string, amount int64) {
	l.balances[account] += amount
}

func (l *Ledger) Balance(account string) int64 {
	return l.balances[account]
}

// Transfer moves amount from one account to another.
func (l *Ledger) Transfer(from, to string, amount int64) error {
	if l.balances[from] < amount {
		return ErrInsufficient
	}
	l.balances[from] -= amount
	l.balances[to] += amount
	return nil
}
`,
  "main.go": `package main

import (
	"encoding/json"
	"log"
	"net/http"
)

type transferRequest struct {
	From   string \`json:"from"\`
	To     string \`json:"to"\`
	Amount int64  \`json:"amount"\`
}

func main() {
	ledger := NewLedger()
	ledger.Deposit("treasury", 1_000_000)
	http.HandleFunc("POST /transfers", func(w http.ResponseWriter, r *http.Request) {
		var req transferRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := ledger.Transfer(req.From, req.To, req.Amount); err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusCreated)
	})
	log.Fatal(http.ListenAndServe(":4020", nil))
}
`,
  "ledger_test.go": `package main

import "testing"

func TestTransfer(t *testing.T) {
	l := NewLedger()
	l.Deposit("a", 100)
	if err := l.Transfer("a", "b", 40); err != nil {
		t.Fatal(err)
	}
	if l.Balance("a") != 60 || l.Balance("b") != 40 {
		t.Fatalf("got a=%d b=%d", l.Balance("a"), l.Balance("b"))
	}
}

func TestInsufficient(t *testing.T) {
	l := NewLedger()
	if err := l.Transfer("a", "b", 1); err != ErrInsufficient {
		t.Fatalf("want ErrInsufficient, got %v", err)
	}
}
`,
};

const platformInfra: Fixture = {
  "README.md": `# platform-infra

Terraform for the shared AWS account: network, the Postgres the ledger runs
on, and the bastion. Terraform is not installed on laptops; CI runs plan and
apply, so changes here are reviewed by reading them.

Policy (from finance, effective next month): every resource carries a
\`cost-center\` tag.
`,
  "main.tf": `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.region
}

module "network" {
  source = "./modules/network"
  cidr   = "10.20.0.0/16"
}

module "db" {
  source    = "./modules/db"
  vpc_id    = module.network.vpc_id
  subnets   = module.network.private_subnets
  app_cidrs = [module.network.cidr]
}
`,
  "variables.tf": `variable "region" {
  type    = string
  default = "eu-central-1"
}
`,
  "modules/network/main.tf": `variable "cidr" { type = string }

resource "aws_vpc" "main" {
  cidr_block = var.cidr
}

resource "aws_subnet" "private" {
  count      = 2
  vpc_id     = aws_vpc.main.id
  cidr_block = cidrsubnet(var.cidr, 8, count.index)
}

output "vpc_id" { value = aws_vpc.main.id }
output "private_subnets" { value = aws_subnet.private[*].id }
output "cidr" { value = var.cidr }
`,
  "modules/db/main.tf": `variable "vpc_id" { type = string }
variable "subnets" { type = list(string) }
variable "app_cidrs" { type = list(string) }

resource "aws_security_group" "db" {
  name   = "ledger-db"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_db_instance" "ledger" {
  identifier             = "ledger"
  engine                 = "postgres"
  instance_class         = "db.t4g.medium"
  allocated_storage      = 50
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = true
  skip_final_snapshot    = true
}
`,
};

const priceScraper: Fixture = {
  ".gitignore": "__pycache__/\n",
  "README.md": `# price-scraper

Reads saved product pages from \`pages/\` and prints their prices.
Turkish shops write prices like \`1.299,90 TL\`.

- \`python3 -m unittest\`
- \`python3 -m scraper.main\`
`,
  "scraper/__init__.py": "",
  "scraper/parse.py": `import re

PRICE = re.compile(r'class="price">([^<]+)<')
TITLE = re.compile(r"<h1>([^<]+)</h1>")


def parse_price(text):
    """'1.299,90 TL' -> 1299.9"""
    number = text.replace("TL", "").strip()
    number = number.replace(",", ".")
    return float(number)


def parse_page(html):
    title = TITLE.search(html).group(1).strip()
    price = parse_price(PRICE.search(html).group(1))
    return {"title": title, "price": price}
`,
  "scraper/main.py": `import pathlib

from scraper.parse import parse_page


def main():
    for page in sorted(pathlib.Path("pages").glob("*.html")):
        item = parse_page(page.read_text(encoding="utf-8"))
        print(f"{item['title']}: {item['price']}")


if __name__ == "__main__":
    main()
`,
  "pages/kulaklik.html": `<html><body><h1>Kablosuz Kulaklık</h1><span class="price">1.299,90 TL</span></body></html>
`,
  "pages/kablo.html": `<html><body><h1>USB-C Kablo</h1><span class="price">89,50 TL</span></body></html>
`,
  "tests/__init__.py": "",
  "tests/test_parse.py": `import unittest

from scraper.parse import parse_price


class ParsePrice(unittest.TestCase):
    def test_small(self):
        self.assertEqual(parse_price("89,50 TL"), 89.5)


if __name__ == "__main__":
    unittest.main()
`,
};

const tidyfs: Fixture = {
  ".gitignore": "node_modules/\n",
  "README.md": `# tidyfs

Find duplicate files under a directory. Small, fast, no dependencies.

    node bin/tidyfs.js <dir>

Prints groups of identical files. MIT licensed. Issues welcome, noise not.
`,
  "package.json": `{
  "name": "tidyfs",
  "version": "0.3.1",
  "type": "module",
  "bin": { "tidyfs": "bin/tidyfs.js" },
  "scripts": { "test": "node --test" }
}
`,
  "bin/tidyfs.js": `#!/usr/bin/env node
import { duplicates } from "../src/dedupe.js";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: tidyfs <dir>");
  process.exit(2);
}
for (const group of await duplicates(dir)) console.log(group.join("\\n") + "\\n");
`,
  "src/walk.js": `import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Every file under dir, following links. */
export async function* walk(dir) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    const info = await stat(path);
    if (info.isDirectory()) yield* walk(path);
    else if (info.isFile()) yield path;
  }
}
`,
  "src/dedupe.js": `import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { walk } from "./walk.js";

export async function duplicates(dir) {
  const byHash = new Map();
  for await (const path of walk(dir)) {
    const hash = createHash("sha256").update(await readFile(path)).digest("hex");
    byHash.set(hash, [...(byHash.get(hash) ?? []), path]);
  }
  return [...byHash.values()].filter((paths) => paths.length > 1);
}
`,
  "test/dedupe.test.js": `import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { duplicates } from "../src/dedupe.js";

test("groups identical files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tidyfs-"));
  await writeFile(join(dir, "a.txt"), "same");
  await writeFile(join(dir, "b.txt"), "same");
  await writeFile(join(dir, "c.txt"), "other");
  const groups = await duplicates(dir);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
});
`,
};

export const FIXTURES = {
  invoicely,
  "invoicely-mobile": invoicelyMobile,
  "ledger-api": ledgerApi,
  "platform-infra": platformInfra,
  "price-scraper": priceScraper,
  tidyfs,
} satisfies Record<string, Fixture>;

export type FixtureName = keyof typeof FIXTURES;
