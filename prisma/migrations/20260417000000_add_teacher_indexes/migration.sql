-- Add missing indexes for Teacher model (performance fix)
-- schoolId index for getAll(schoolId) queries
CREATE INDEX IF NOT EXISTS "Teacher_schoolId_idx" ON "Teacher"("schoolId");

-- Composite index for findAll(schoolId, type) queries  
CREATE INDEX IF NOT EXISTS "Teacher_schoolId_type_idx" ON "Teacher"("schoolId", "type");
