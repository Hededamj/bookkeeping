const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: {
      activeCompany: true,
      companies: { include: { company: true } }
    }
  });
  console.log('Users with active company:');
  users.forEach(u => {
    console.log('- ' + u.email);
    console.log('  Active company: ' + (u.activeCompany?.name || 'NONE'));
    console.log('  Has access to:');
    u.companies.forEach(uc => console.log('    - ' + uc.company.name + ' (id: ' + uc.company.id + ')'));
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
