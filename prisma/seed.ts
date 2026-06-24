import "dotenv/config";
import { PrismaClient, AccountType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  await prisma.journalLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.account.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.taxRate.deleteMany();

  const accounts = [
    { code: "1000", name: "Cash", type: AccountType.ASSET },
    { code: "1100", name: "Bank Account", type: AccountType.ASSET },
    { code: "1200", name: "Accounts Receivable", type: AccountType.ASSET },
    { code: "2000", name: "Accounts Payable", type: AccountType.LIABILITY },
    { code: "2100", name: "VAT Payable", type: AccountType.LIABILITY },
    { code: "3000", name: "Owner's Equity", type: AccountType.EQUITY },
    { code: "4000", name: "Revenue", type: AccountType.REVENUE },
    { code: "5000", name: "Office Supplies", type: AccountType.EXPENSE },
    { code: "5100", name: "Software & Subscriptions", type: AccountType.EXPENSE },
    { code: "5200", name: "Professional Services", type: AccountType.EXPENSE },
  ];

  await prisma.account.createMany({ data: accounts });
  console.log(`Seeded ${accounts.length} accounts`);

  // Seed realistic tax rates (multi-jurisdiction, effective dates, types)
  const taxRates = [
    {
      jurisdiction: 'DE',
      name: 'MwSt 19%',
      rate: 0.19,
      taxType: 'STANDARD',
      isInputTax: false,
      description: 'German VAT standard rate',
    },
    {
      jurisdiction: 'DE',
      name: 'MwSt 7%',
      rate: 0.07,
      taxType: 'REDUCED',
      isInputTax: false,
      description: 'German VAT reduced rate (food, books, etc.)',
    },
    {
      jurisdiction: 'DE',
      name: 'Vorsteuer 19%',
      rate: 0.19,
      taxType: 'STANDARD',
      isInputTax: true,
      description: 'German input VAT (recoverable)',
    },
    {
      jurisdiction: 'AT',
      name: 'USt 20%',
      rate: 0.20,
      taxType: 'STANDARD',
      isInputTax: false,
    },
    {
      jurisdiction: 'US-CA',
      name: 'Sales Tax 8.25%',
      rate: 0.0825,
      taxType: 'STANDARD',
      isInputTax: false,
    },
  ];

  await prisma.taxRate.createMany({ data: taxRates as any });
  console.log(`Seeded ${taxRates.length} tax rates`);

  // Seed default company settings (used by Admin UI)
  const defaultSettings = [
    { key: 'company.name', value: { value: 'Acme GmbH' } },
    { key: 'baseCurrency', value: { value: 'EUR' } },
    { key: 'defaultTaxJurisdiction', value: { value: 'DE' } },
  ];

  for (const s of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value as any },
      create: { key: s.key, value: s.value as any },
    });
  }
  console.log(`Seeded/updated ${defaultSettings.length} default settings`);

  await prisma.contact.create({
    data: {
      name: "Acme Corp",
      email: "billing@acme.example",
      type: "CUSTOMER",
    },
  });
  console.log("Seeded sample contact");

  const cash = await prisma.account.findUnique({ where: { code: "1000" } });
  const equity = await prisma.account.findUnique({ where: { code: "3000" } });

  if (cash && equity) {
    const entry = await prisma.journalEntry.create({
      data: {
        date: new Date(),
        description: "Initial capital contribution",
        lines: {
          create: [
            { accountId: cash.id, debit: 10000, credit: 0, description: "Cash received" },
            { accountId: equity.id, debit: 0, credit: 10000, description: "Owner equity" },
          ],
        },
      },
      include: {
        lines: {
          include: { account: { select: { code: true } } }
        }
      }
    });

    await prisma.event.create({
      data: {
        eventType: "JOURNAL_ENTRY_CREATED",
        entityType: "JournalEntry",
        entityId: entry.id,
        payload: {
          description: entry.description,
          date: entry.date,
          lines: entry.lines.map((l: any) => ({
            account: l.account.code,
            debit: Number(l.debit),
            credit: Number(l.credit)
          }))
        }
      }
    });
    console.log("Seeded initial journal entry + audit event");
  }

  console.log("Seeding complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
