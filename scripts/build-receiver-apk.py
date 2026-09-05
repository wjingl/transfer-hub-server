# ============================================================================
# 构建「仅接收」Android APK：
#   1) 取完整 Release APK（webapp/transfer-hub-android.apk，与内核同构建）
#   2) 用 webapp/receiver-only/（含接收守卫）替换其 assets/public 全部网页资产
#   3) 去除旧签名 → 重对齐（zipalign）→ 用项目密钥重签（apksigner）
# 说明：这是服务器分发侧的包装步骤；trans 工程与签名密钥均只读引用，不改动。
# 环境变量（可覆盖）：
#   ANDROID_SDK   默认 W:/0_proj/trans/.android-sdk
#   KEYSTORE      默认 W:/0_proj/trans/android-capacitor/transferhub.keystore
#   KS_PASS       默认 transferhub123
#   KS_ALIAS      默认 transferhub
# 用法：python scripts/build-receiver-apk.py
# ============================================================================
import os
import shutil
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_APK = os.path.join(ROOT, 'webapp', 'transfer-hub-android.apk')
WWW_DIR = os.path.join(ROOT, 'webapp', 'receiver-only')
OUT_APK = os.path.join(ROOT, 'webapp', 'transfer-hub-receiver-android.apk')

ANDROID_SDK = os.environ.get('ANDROID_SDK', 'W:/0_proj/trans/.android-sdk')
BUILD_TOOLS = os.path.join(ANDROID_SDK, 'build-tools', '34.0.0')
ZIPALIGN = os.path.join(BUILD_TOOLS, 'zipalign.exe')
APKSIGNER = os.path.join(BUILD_TOOLS, 'apksigner.bat')
KEYSTORE = os.environ.get('KEYSTORE', 'W:/0_proj/trans/android-capacitor/transferhub.keystore')
KS_PASS = os.environ.get('KS_PASS', 'transferhub123')
KS_ALIAS = os.environ.get('KS_ALIAS', 'transferhub')
JAVA_HOME = os.environ.get('JAVA_HOME', 'W:/0_proj/trans/.android-sdk/jdk17/jdk-17.0.20.1+1')

ASSET_PREFIX = 'assets/public/'
UNSUPPORTED_STORED = ('resources.arsc',)


def fail(msg):
    print(f'[receiver-apk] ✗ {msg}', file=sys.stderr)
    sys.exit(1)


def main():
    for p in (SRC_APK, WWW_DIR, ZIPALIGN, APKSIGNER, KEYSTORE):
        if not os.path.exists(p):
            fail(f'缺少文件：{p}')

    env = dict(os.environ, JAVA_HOME=JAVA_HOME)
    work = OUT_APK + '.work'

    # 1) 重写 zip：去掉旧签名与网页资产，放入 receiver-only www
    if os.path.exists(work):
        os.remove(work)
    replaced = 0
    with zipfile.ZipFile(SRC_APK, 'r') as src, zipfile.ZipFile(work, 'w', zipfile.ZIP_DEFLATED) as dst:
        names = set(src.namelist())
        www_files = {}
        for base, _dirs, files in os.walk(WWW_DIR):
            for f in files:
                full = os.path.join(base, f)
                rel = os.path.relpath(full, WWW_DIR).replace('\\', '/')
                www_files[ASSET_PREFIX + rel] = full
        removed_assets = 0
        for info in src.infolist():
            name = info.filename
            if name.startswith('META-INF/'):
                continue  # 旧签名
            if name.startswith(ASSET_PREFIX):
                removed_assets += 1
                continue  # 网页资产整体替换
            # resources.arsc 必须不压缩存储（targetSdk>=30 要求）
            compress = zipfile.ZIP_STORED if name in UNSUPPORTED_STORED else zipfile.ZIP_DEFLATED
            dst.writestr(info, src.read(name), compress_type=compress)
        for arcname, full in sorted(www_files.items()):
            dst.write(full, arcname, compress_type=zipfile.ZIP_DEFLATED)
            replaced += 1
        _ = names
    print(f'[receiver-apk] www 重写：移除原资产 {removed_assets} 项，写入 receiver-only {replaced} 项')

    # 2) zipalign（签名前）
    aligned = OUT_APK + '.aligned'
    if os.path.exists(aligned):
        os.remove(aligned)
    subprocess.run([ZIPALIGN, '-f', '4', work, aligned], check=True, env=env)

    # 3) apksigner 重签 + 校验
    if os.path.exists(OUT_APK):
        os.remove(OUT_APK)
    subprocess.run([
        APKSIGNER, 'sign',
        '--ks', KEYSTORE,
        '--ks-key-alias', KS_ALIAS,
        '--ks-pass', f'pass:{KS_PASS}',
        '--key-pass', f'pass:{KS_PASS}',
        '--out', OUT_APK,
        aligned,
    ], check=True, env=env)
    subprocess.run([APKSIGNER, 'verify', '--print-certs', OUT_APK], check=True, env=env)

    os.remove(work)
    os.remove(aligned)
    size = os.path.getsize(OUT_APK)
    print(f'[receiver-apk] ✓ {OUT_APK} ({size} B)')


if __name__ == '__main__':
    main()
