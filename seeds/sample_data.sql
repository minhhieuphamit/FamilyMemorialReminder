-- Dữ liệu mẫu để thử nghiệm. Tách khỏi migrations để không lẫn vào dữ liệu thật.
-- Xóa sạch bằng: DELETE FROM memorial_events WHERE notes LIKE '[Mẫu]%';

INSERT INTO families (name) VALUES ('Nhà nội'), ('Nhà ngoại') ON CONFLICT (name) DO NOTHING;

INSERT INTO memorial_events
  (full_name, relationship, lunar_day, lunar_month, is_leap_month, death_year, death_solar_date, notes, leap_month_rule, missing_day_rule, reminder_enabled, reminder_offsets, family_id)
VALUES
  ('Nguyễn Văn An',  'Ông nội',   15, 8,  0, 1998, NULL,         '[Mẫu] Chuẩn bị đồ cúng, gọi các cô chú về sớm', 'exact',             'skip',     1, NULL, (SELECT id FROM families WHERE name = 'Nhà nội')),
  ('Trần Thị Bình',  'Bà nội',    10, 3,  0, 2005, NULL,         '[Mẫu] Cúng chay',                               'exact',             'skip',     1, NULL, (SELECT id FROM families WHERE name = 'Nhà nội')),
  ('Lê Văn Cường',   'Ông ngoại', 30, 12, 0, 2010, NULL,         '[Mẫu] Tháng 12 có năm thiếu, dùng ngày cuối',   'exact',             'last_day', 1, '[7,1,0]', (SELECT id FROM families WHERE name = 'Nhà ngoại')),
  ('Phạm Thị Dung',  'Bà ngoại',  20, 6,  1, 2017, '2017-08-11', '[Mẫu] Mất vào tháng 6 nhuận, năm không nhuận cúng tháng 6 thường', 'leap_if_available', 'skip', 1, NULL, (SELECT id FROM families WHERE name = 'Nhà ngoại')),
  ('Nguyễn Văn Em',  'Chú',        2, 10, 0, NULL, NULL,         '[Mẫu] Không nhớ năm mất',                       'exact',             'skip',     0, NULL, (SELECT id FROM families WHERE name = 'Nhà nội')),
  ('Đỗ Thị Giang',   'Cô',        30, 10, 0, 2015, NULL,         '[Mẫu] Chưa chọn quy tắc: năm tháng 10 thiếu sẽ báo cần xử lý', 'exact', 'skip',  1, NULL, NULL);
