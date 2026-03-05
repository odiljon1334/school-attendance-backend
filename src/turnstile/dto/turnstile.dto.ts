import { IsArray, IsIn, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export type TurnstileUserType = 'student' | 'teacher' | 'director';

export class UploadTurnstilePhotoDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  photo!: string;

  @IsIn(['student', 'teacher', 'director'])
  userType!: TurnstileUserType;
}

export class UpdateTurnstilePhotoDto extends UploadTurnstilePhotoDto {}

export class SyncUserDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  photo!: string;

  @IsIn(['student', 'teacher', 'director'])
  type!: TurnstileUserType;
}

export class SyncSchoolPhotosDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncUserDto)
  users!: SyncUserDto[];
}