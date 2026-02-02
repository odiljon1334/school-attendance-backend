import {
  Class,
  District,
  PrismaClient,
  School,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clear existing data (optional - comment out if you want to keep existing data)
  await prisma.smsLog.deleteMany();
  await prisma.telegramSubscription.deleteMany();
  await prisma.paymentRecord.deleteMany();
  await prisma.absenceRecord.deleteMany();
  await prisma.attendanceLog.deleteMany();
  await prisma.parent.deleteMany(); // ← Parent birinchi
  await prisma.student.deleteMany(); // ← Student keyin
  await prisma.teacher.deleteMany();
  await prisma.director.deleteMany();
  await prisma.schoolAdmin.deleteMany();
  await prisma.districtAdmin.deleteMany();
  await prisma.device.deleteMany();
  await prisma.class.deleteMany();
  await prisma.school.deleteMany();
  await prisma.district.deleteMany();
  await prisma.user.deleteMany();

  console.log('✅ Cleared existing data');

  // Hash password
  const hashedPassword = await bcrypt.hash('password123', 10);

  // 1. Create SUPER_ADMIN
  const superAdmin = await prisma.user.create({
    data: {
      username: 'superadmin',
      email: 'admin@school.uz',
      password: hashedPassword,
      role: UserRole.SUPER_ADMIN,
      status: 'ACTIVE',
    },
  });

  console.log('✅ Created SUPER_ADMIN:', superAdmin.username);

  // 2. Create Districts
  const tashkentDistrict = await prisma.district.create({
    data: {
      name: 'Toshkent shahar',
      region: 'Toshkent',
      code: 'TASH-001',
    },
  });

  const samarqandDistrict: District = await prisma.district.create({
    data: {
      name: 'Samarqand shahar',
      region: 'Samarqand',
      code: 'SAM-001',
    },
  });

  console.log('✅ Created Districts', samarqandDistrict);

  // 3. Create District Admins
  const districtAdmin1User = await prisma.user.create({
    data: {
      username: 'district_admin_tashkent',
      email: 'district.tashkent@school.uz',
      password: hashedPassword,
      role: UserRole.DISTRICT_ADMIN,
      status: 'ACTIVE',
    },
  });

  await prisma.districtAdmin.create({
    data: {
      userId: districtAdmin1User.id,
      districtId: tashkentDistrict.id,
      firstName: 'Aziz',
      lastName: 'Alimov',
      phone: '+998901234567',
    },
  });

  console.log('✅ Created District Admin for Tashkent');

  // 4. Create Schools
  const school1 = await prisma.school.create({
    data: {
      districtId: tashkentDistrict.id,
      name: "15-umumiy o'rta ta'lim maktabi",
      address: 'Toshkent, Chilonzor tumani',
      phone: '+998712345678',
      email: 'school15@edu.uz',
      code: 'SCH-015',
    },
  });

  const school2: School = await prisma.school.create({
    data: {
      districtId: tashkentDistrict.id,
      name: "42-umumiy o'rta ta'lim maktabi",
      address: 'Toshkent, Yunusobod tumani',
      phone: '+998712345679',
      email: 'school42@edu.uz',
      code: 'SCH-042',
    },
  });

  console.log('✅ Created Schools', school2);

  // 5. Create School Admins
  const schoolAdmin1User = await prisma.user.create({
    data: {
      username: 'school_admin_15',
      email: 'admin.school15@edu.uz',
      password: hashedPassword,
      role: UserRole.SCHOOL_ADMIN,
      status: 'ACTIVE',
    },
  });

  await prisma.schoolAdmin.create({
    data: {
      userId: schoolAdmin1User.id,
      schoolId: school1.id,
      firstName: 'Dilshod',
      lastName: 'Karimov',
      phone: '+998901234568',
    },
  });

  console.log('✅ Created School Admin for School 15');

  // 6. Create Director
  const directorUser = await prisma.user.create({
    data: {
      username: 'director_school15',
      email: 'director.school15@edu.uz',
      password: hashedPassword,
      role: UserRole.DIRECTOR,
      status: 'ACTIVE',
    },
  });

  await prisma.director.create({
    data: {
      userId: directorUser.id,
      schoolId: school1.id,
      firstName: 'Jahongir',
      lastName: 'Rahimov',
      phone: '+998901234569',
    },
  });

  console.log('✅ Created Director for School 15');

  // 7. Create Classes
  const class9A = await prisma.class.create({
    data: {
      schoolId: school1.id,
      grade: 9,
      section: 'A',
      academicYear: '2024-2025',
    },
  });

  const class10B: Class = await prisma.class.create({
    data: {
      schoolId: school1.id,
      grade: 10,
      section: 'B',
      academicYear: '2024-2025',
    },
  });

  console.log('✅ Created Classes', class10B);

  // 8. Create Teachers
  const teacher1User = await prisma.user.create({
    data: {
      username: 'teacher_mathematics',
      email: 'teacher.math@school15.uz',
      password: hashedPassword,
      role: UserRole.TEACHER,
      status: 'ACTIVE',
    },
  });

  await prisma.teacher.create({
    data: {
      userId: teacher1User.id,
      schoolId: school1.id,
      firstName: 'Nodira',
      lastName: 'Tursunova',
      phone: '+998901234570',
      subjects: ['Matematika', 'Algebra'],
      telegramId: '@nodira_teacher',
    },
  });

  const teacher2User = await prisma.user.create({
    data: {
      username: 'teacher_physics',
      email: 'teacher.physics@school15.uz',
      password: hashedPassword,
      role: UserRole.TEACHER,
      status: 'ACTIVE',
    },
  });

  await prisma.teacher.create({
    data: {
      userId: teacher2User.id,
      schoolId: school1.id,
      firstName: 'Sardor',
      lastName: 'Umarov',
      phone: '+998901234571',
      subjects: ['Fizika'],
      telegramId: '@sardor_physics',
    },
  });

  console.log('✅ Created Teachers');

  // 9. Create Students
  const student1User = await prisma.user.create({
    data: {
      username: 'student_ali',
      email: 'ali.student@school15.uz',
      password: hashedPassword,
      role: UserRole.STUDENT,
      status: 'ACTIVE',
    },
  });

  const student1 = await prisma.student.create({
    data: {
      userId: student1User.id,
      schoolId: school1.id,
      classId: class9A.id,
      firstName: 'Ali',
      lastName: 'Yusupov',
      middleName: 'Karimovich',
      gender: 'MALE',
      phone: '+998901234572',
      dateOfBirth: new Date('2010-05-15'),
      isTelegramSubscribed: true,
      telegramId: '@ali_student',
      telegramChatId: '123456789',
    },
  });

  const student2User = await prisma.user.create({
    data: {
      username: 'student_zarina',
      email: 'zarina.student@school15.uz',
      password: hashedPassword,
      role: UserRole.STUDENT,
      status: 'ACTIVE',
    },
  });

  const student2 = await prisma.student.create({
    data: {
      userId: student2User.id,
      schoolId: school1.id,
      classId: class9A.id,
      firstName: 'Zarina',
      lastName: 'Rustamova',
      middleName: 'Akmalovna',
      gender: 'FEMALE',
      phone: '+998901234573',
      dateOfBirth: new Date('2010-08-22'),
      isTelegramSubscribed: false,
    },
  });

  console.log('✅ Created Students');

  // 10. Create Parent
  const parent1User = await prisma.user.create({
    data: {
      username: 'parent_ali',
      email: 'parent.ali@gmail.com',
      password: hashedPassword,
      role: UserRole.PARENT,
      status: 'ACTIVE',
    },
  });

  await prisma.parent.create({
    data: {
      userId: parent1User.id,
      studentId: student1.id,
      firstName: 'Karim',
      lastName: 'Yusupov',
      phone: '+998901234574',
      relationship: 'father',
      isTelegramSubscribed: true,
      telegramId: '@karim_parent',
      telegramChatId: '987654321',
    },
  });

  console.log('✅ Created Parent');

  // 11. Create Devices (Hikvision)
  await prisma.device.create({
    data: {
      schoolId: school1.id,
      name: 'Entrance Terminal 1',
      deviceId: 'HIK-001',
      ipAddress: '192.168.1.100',
      port: 80,
      username: 'admin',
      password: 'admin123',
      isActive: true,
      location: 'Main Entrance',
    },
  });

  await prisma.device.create({
    data: {
      schoolId: school1.id,
      name: 'Exit Terminal 1',
      deviceId: 'HIK-002',
      ipAddress: '192.168.1.101',
      port: 80,
      username: 'admin',
      password: 'admin123',
      isActive: true,
      location: 'Main Exit',
    },
  });

  console.log('✅ Created Hikvision Devices');

  // 12. Create Sample Attendance Logs
  // Avval device ni olish kerak
  const device1 = await prisma.device.findUnique({
    where: { deviceId: 'HIK-001' },
  });

  await prisma.attendanceLog.create({
    data: {
      schoolId: school1.id,
      studentId: student1.id,
      date: new Date(),
      checkInTime: new Date('2024-02-01T07:50:00'),
      status: 'PRESENT',
      lateMinutes: 0,
      deviceId: device1?.id, // ← Device ning database ID si
    },
  });

  await prisma.attendanceLog.create({
    data: {
      schoolId: school1.id,
      studentId: student2.id,
      date: new Date(),
      checkInTime: new Date('2024-02-01T08:15:00'),
      status: 'LATE',
      lateMinutes: 15,
      deviceId: device1?.id, // ← Device ning database ID si
    },
  });

  console.log('✅ Created Sample Attendance Logs');

  // 13. Create Payment Records
  await prisma.paymentRecord.create({
    data: {
      studentId: student1.id,
      amount: 500000,
      paymentDate: new Date(),
      status: 'PAID',
      type: 'tuition',
      description: "Yanvar oyi uchun to'lov",
    },
  });

  await prisma.paymentRecord.create({
    data: {
      studentId: student2.id,
      amount: 500000,
      paymentDate: new Date(),
      status: 'UNPAID',
      type: 'tuition',
      description: "Yanvar oyi uchun to'lov",
    },
  });

  console.log('✅ Created Payment Records');

  console.log('\n🎉 Database seeding completed successfully!\n');
  console.log('📝 Test Credentials:');
  console.log('================================');
  console.log('SUPER ADMIN:');
  console.log('  Username: superadmin');
  console.log('  Password: password123\n');
  console.log('DISTRICT ADMIN (Tashkent):');
  console.log('  Username: district_admin_tashkent');
  console.log('  Password: password123\n');
  console.log('SCHOOL ADMIN (School 15):');
  console.log('  Username: school_admin_15');
  console.log('  Password: password123\n');
  console.log('DIRECTOR (School 15):');
  console.log('  Username: director_school15');
  console.log('  Password: password123\n');
  console.log('TEACHER (Mathematics):');
  console.log('  Username: teacher_mathematics');
  console.log('  Password: password123\n');
  console.log('STUDENT (Ali):');
  console.log('  Username: student_ali');
  console.log('  Password: password123\n');
  console.log('================================');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
