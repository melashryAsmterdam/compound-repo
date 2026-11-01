-- Fixed MVP category list (PRD A3-AC8, Q-11).
INSERT INTO request_category (code, name_ar, name_en, icon, sort_order) VALUES
  ('plumbing',        'سباكة',              'Plumbing',            'droplet',     1),
  ('electrical',      'كهرباء',             'Electrical',          'zap',         2),
  ('ac_hvac',         'تكييف',              'AC / HVAC',           'snowflake',   3),
  ('carpentry_doors', 'نجارة وأبواب',       'Carpentry & Doors',   'door',        4),
  ('painting_walls',  'دهان وجدران',        'Painting & Walls',    'paint-roller',5),
  ('pest_control',    'مكافحة حشرات',       'Pest Control',        'bug',         6),
  ('cleaning',        'نظافة',              'Cleaning',            'sparkles',    7),
  ('other',           'أخرى',               'Other',               'more',        8)
ON CONFLICT (code) DO NOTHING;
