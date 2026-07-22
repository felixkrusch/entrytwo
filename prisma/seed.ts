import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { accountsForLocale, normalizeLocale } from "../lib/chartOfAccounts";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "ExpenseClaimLineReceipt", "ExpenseClaimApproval", "ExpenseClaimActivity", "ExpenseClaimReimbursement",
    "ExpenseClaimReceipt", "ExpenseClaimLine", "ExpenseClaim", "TotpRecoveryCode",
    "ChatMessageAttachment", "ChatMessage", "ChatThread",
    "JournalAttachment", "FileAsset", "InvoiceLine", "FeedTransaction", "BankConnection",
    "RecurringInvoice", "JournalLine", "Invoice", "RecurringJournalEntry",
    "Template", "Setting", "AgentMemory", "AccountingBranch", "Snapshot",
    "JournalEntry", "Event", "TaxRate", "Contact", "Account", "User"
    RESTART IDENTITY CASCADE`);

  const locale = normalizeLocale(process.env.SEED_LANGUAGE || process.env.DEFAULT_LANGUAGE || "en");
  const accounts = accountsForLocale(locale);

  await prisma.account.createMany({ data: accounts });
  console.log(`Seeded ${accounts.length} accounts (${locale})`);

  const taxRates = [
    {
      jurisdiction: "DE",
      name: "MwSt 19%",
      rate: 0.19,
      taxType: "STANDARD",
      description: "German VAT standard rate",
    },
    {
      jurisdiction: "DE",
      name: "MwSt 7%",
      rate: 0.07,
      taxType: "REDUCED",
      description: "German VAT reduced rate (food, books, etc.)",
    },
    {
      jurisdiction: "AT",
      name: "USt 20%",
      rate: 0.2,
      taxType: "STANDARD",
    },
    {
      jurisdiction: "US-CA",
      name: "Sales Tax 8.25%",
      rate: 0.0825,
      taxType: "STANDARD",
    },
  ];

  const taxRateData: Prisma.TaxRateCreateManyInput[] = taxRates;
  await prisma.taxRate.createMany({ data: taxRateData });
  console.log(`Seeded ${taxRates.length} tax rates`);

  const defaultSettings = [
    { key: "company.name", value: { value: locale === "de" ? "Muster GmbH" : "Acme GmbH" } },
    { key: "baseCurrency", value: { value: "EUR" } },
    { key: "defaultTaxJurisdiction", value: { value: "DE" } },
    { key: "company.defaultLanguage", value: { value: locale } },
  ];

  for (const s of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value as Prisma.InputJsonValue },
      create: { key: s.key, value: s.value as Prisma.InputJsonValue },
    });
  }
  console.log(`Seeded/updated ${defaultSettings.length} default settings`);

  await prisma.contact.create({
    data: {
      name: "Acme Corp",
      email: "billing@acme.example",
      type: "CUSTOMER",
      preferredLanguage: locale,
    },
  });
  console.log("Seeded sample contact");

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
