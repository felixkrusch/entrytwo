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
    // Assets
    { code: "1000", name: "Cash", type: AccountType.ASSET },
    { code: "1010", name: "Bank Account - Checking", type: AccountType.ASSET },
    { code: "1020", name: "Bank Account - Savings", type: AccountType.ASSET },
    { code: "1100", name: "Accounts Receivable", type: AccountType.ASSET },
    { code: "1200", name: "Inventory", type: AccountType.ASSET },
    { code: "1300", name: "Prepaid Expenses", type: AccountType.ASSET },
    { code: "1500", name: "Equipment", type: AccountType.ASSET },
    { code: "1510", name: "Vehicles", type: AccountType.ASSET },
    { code: "1600", name: "Accumulated Depreciation", type: AccountType.ASSET },

    // Liabilities
    { code: "2000", name: "Accounts Payable", type: AccountType.LIABILITY },
    { code: "2100", name: "Credit Cards", type: AccountType.LIABILITY },
    { code: "2200", name: "Sales Tax Payable", type: AccountType.LIABILITY },
    { code: "2300", name: "Payroll Liabilities", type: AccountType.LIABILITY },
    { code: "2500", name: "Loans Payable", type: AccountType.LIABILITY },
    { code: "2600", name: "Mortgage Payable", type: AccountType.LIABILITY },

    // Equity
    { code: "3000", name: "Owner's Capital", type: AccountType.EQUITY },
    { code: "3100", name: "Owner's Drawings", type: AccountType.EQUITY },
    { code: "3200", name: "Retained Earnings", type: AccountType.EQUITY },

    // Revenue
    { code: "4000", name: "Sales / Service Revenue", type: AccountType.REVENUE },
    { code: "4100", name: "Consulting Revenue", type: AccountType.REVENUE },
    { code: "4200", name: "Other Income", type: AccountType.REVENUE },

    // Expenses
    { code: "5000", name: "Cost of Goods Sold", type: AccountType.EXPENSE },
    { code: "5100", name: "Rent Expense", type: AccountType.EXPENSE },
    { code: "5200", name: "Utilities", type: AccountType.EXPENSE },
    { code: "5300", name: "Salaries & Wages", type: AccountType.EXPENSE },
    { code: "5400", name: "Marketing & Advertising", type: AccountType.EXPENSE },
    { code: "5500", name: "Office Supplies", type: AccountType.EXPENSE },
    { code: "5600", name: "Travel & Meals", type: AccountType.EXPENSE },
    { code: "5700", name: "Professional Fees", type: AccountType.EXPENSE },
    { code: "5800", name: "Insurance", type: AccountType.EXPENSE },
    { code: "5900", name: "Depreciation Expense", type: AccountType.EXPENSE },
    { code: "6000", name: "Miscellaneous Expense", type: AccountType.EXPENSE },
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
