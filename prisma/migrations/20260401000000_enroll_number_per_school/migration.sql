-- Remove global unique constraint on enrollNumber for Student
DROP INDEX IF EXISTS "Student_enrollNumber_key";

-- Remove global unique constraint on enrollNumber for Teacher
DROP INDEX IF EXISTS "Teacher_enrollNumber_key";

-- Add per-school unique constraint for Student (only on non-null values)
CREATE UNIQUE INDEX "Student_schoolId_enrollNumber_key"
  ON "Student"("schoolId", "enrollNumber")
  WHERE "enrollNumber" IS NOT NULL;

-- Add per-school unique constraint for Teacher (only on non-null values)
CREATE UNIQUE INDEX "Teacher_schoolId_enrollNumber_key"
  ON "Teacher"("schoolId", "enrollNumber")
  WHERE "enrollNumber" IS NOT NULL AND "schoolId" IS NOT NULL;
