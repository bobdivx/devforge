import paramiko
import sys

KEY = r"C:\Users\auber\.ssh\id_ed25519_demeter"
PWD = "8tc6vr89"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("10.1.0.88", username="bobdivx", key_filename=KEY, timeout=20)

def run(cmd: str, timeout: int = 7200) -> None:
    _, stdout, stderr = c.exec_command(f"bash -lc {repr(cmd)}", timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    if out:
        sys.stdout.write(out)
    if err:
        sys.stderr.write(err)

run(f"printf '%s\\n' '{PWD}' > ~/.demeter_sudo_pass && chmod 600 ~/.demeter_sudo_pass")
run(f"echo '{PWD}' | sudo -S pacman -S --noconfirm npm 2>&1 | tail -3")
run("pkill -f bootstrap-phase3.sh 2>/dev/null || true; pkill -f 'yay -S' 2>/dev/null || true")
run("nohup bash ~/bootstrap-phase3.sh > ~/demeter-bootstrap-phase3.log 2>&1 & echo PHASE3_STARTED")
c.close()
