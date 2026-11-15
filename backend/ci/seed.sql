-- The minimum data the tests expect to find in an empty test database (loaded after schema.sql). Only invented values:
-- no real person, address or price list. Everything else is created by the server's own idempotent start-up code and by the tests.

INSERT INTO plans (id, nome, duracao_meses, preco_sessao, duration_weeks) VALUES
    (1, '1 Month Pack', 1, 65, 4),
    (2, '3 Months Pack', 3, 60, 12),
    (3, '6 Months Pack', 6, 55, 24);

INSERT INTO trainers (id, nome, email, especialidade, active, color) VALUES
    (8,  'Carles',   'carles@example.test',   'Personal Training',       TRUE, '#34d399'),
    (9,  'David',    'david.t@example.test',  'Personal Training',       TRUE, '#38bdf8'),
    (10, 'Guille',   'guille@example.test',   'Performance',             TRUE, '#f59e0b'),
    (11, 'Matilda',  'matilda@example.test',  'Strength & Conditioning', TRUE, '#f472b6'),
    (12, 'Dominika', 'dominika@example.test', 'Personal Training',       TRUE, '#a78bfa');

INSERT INTO trainer_availability (trainer_id, day_of_week, start_time, end_time)
SELECT t.id, d.day, '07:00', '21:00'
FROM trainers t CROSS JOIN (VALUES ('Monday'), ('Tuesday'), ('Wednesday'), ('Thursday'), ('Friday')) AS d(day);

SELECT setval(pg_get_serial_sequence('plans', 'id'), (SELECT MAX(id) FROM plans));
SELECT setval(pg_get_serial_sequence('trainers', 'id'), (SELECT MAX(id) FROM trainers));
