凭邀请码参与该项测试，每个邀请码对应一个测评结果。

步骤 1・在你自己的 Supabase里建表 / 建函数 / 灌邀请码

打开你的 Supabase Dashboard：
进入 SQL Editor，把下面 3 段 SQL 依次粘贴进去执行（可以一次全粘也行，中间会有分号）：
① 建表 + 索引 + RLS

CREATE TABLE IF NOT EXISTS invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code         TEXT UNIQUE NOT NULL,
  note         TEXT DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  child_name   TEXT,
  child_gender TEXT,
  age_group    TEXT,
  answers      JSONB,
  result       JSONB
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_completed ON invites(completed_at) WHERE completed_at IS NOT NULL;

ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

② 建 2 个 RPC 函数
CREATE OR REPLACE FUNCTION validate_invite(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RETURN jsonb_build_object('status', 'missing');
  END IF;

  SELECT * INTO v_row FROM invites WHERE code = trim(p_code) LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_row.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status',       'completed',
      'child_name',   v_row.child_name,
      'child_gender', v_row.child_gender,
      'age_group',    v_row.age_group,
      'result',       v_row.result,
      'completed_at', v_row.completed_at
    );
  END IF;

  UPDATE invites
     SET started_at = COALESCE(started_at, NOW())
   WHERE code = trim(p_code);

  RETURN jsonb_build_object('status', 'ready', 'note', v_row.note);
END;
$$;

CREATE OR REPLACE FUNCTION complete_quiz(
  p_code         TEXT,
  p_child_name   TEXT,
  p_child_gender TEXT,
  p_age_group    TEXT,
  p_answers      JSONB,
  p_result       JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT * INTO v_row FROM invites WHERE code = trim(p_code) LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_row.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  UPDATE invites SET
    child_name   = p_child_name,
    child_gender = p_child_gender,
    age_group    = p_age_group,
    answers      = p_answers,
    result       = p_result,
    completed_at = NOW()
  WHERE code = trim(p_code)
    AND completed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'already_completed');
  END IF;

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

GRANT EXECUTE ON FUNCTION validate_invite(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_quiz(TEXT, TEXT, TEXT, TEXT, JSONB, JSONB) TO anon, authenticated;

③ 生成 30 个邀请码

INSERT INTO invites (code, note)
SELECT
  substr(
    translate(
      encode(gen_random_bytes(12), 'base64'),
      '+/=0O1lI',
      'abcdefgh'
    ),
    1, 8
  ) AS code,
  '批次 A · ' || to_char(NOW(), 'YYYY-MM-DD') AS note
FROM generate_series(1, 30)
ON CONFLICT (code) DO NOTHING;

SELECT code, note FROM invites ORDER BY created_at DESC LIMIT 30;
