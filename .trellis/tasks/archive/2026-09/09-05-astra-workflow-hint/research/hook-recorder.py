"""实验专用透明记录器：只保存真实事件及输出，不参与生产安装。"""

import json
import os
import subprocess
import sys
from pathlib import Path
root=Path(__file__).resolve().parent
payload=sys.stdin.read()
result=subprocess.run(sys.argv[1:],input=payload,text=True,capture_output=True,cwd=root)
data=json.loads(payload)
record={"input":{key:data.get(key) for key in ("hook_event_name","model","source","session_id")},"non_interactive":os.environ.get("CODEX_NON_INTERACTIVE"),"args":sys.argv[1:],"stdout":result.stdout,"stderr":result.stderr,"exit_code":result.returncode}
with (root/"hook-evidence.jsonl").open("a") as stream: stream.write(json.dumps(record)+"\n")
sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
sys.exit(result.returncode)
