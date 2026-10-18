#!/bin/bash
#
# 容器内「事中看画面」：Xvfb + x11vnc（只读）+ noVNC。
# 由 supervisor 守护；任一子进程退出就整体重启，避免留下半套服务。
#
# 浏览器端的入口是 nginx 8080 的 /vnc/（见 config/nginx_playwright.conf），
# 本脚本只监听容器内回环地址，不直接暴露到宿主机。

export DISPLAY="${DISPLAY:-:99}"

SCREEN="${HARNESS_LIVE_VIEW_SCREEN:-1600x1000x24}"
RFB_PORT="${HARNESS_VNC_PORT:-5900}"
WEB_PORT="${HARNESS_NOVNC_PORT:-6080}"
DISPLAY_NUM="${DISPLAY#:}"

XVFB_PID=""
X11VNC_PID=""
WEBSOCKIFY_PID=""

cleanup()
{
    [ -n "$WEBSOCKIFY_PID" ] && kill "$WEBSOCKIFY_PID" 2>/dev/null
    [ -n "$X11VNC_PID" ] && kill "$X11VNC_PID" 2>/dev/null
    [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null
    wait 2>/dev/null
}

trap cleanup EXIT
trap 'exit 1' INT TERM

Xvfb "$DISPLAY" -screen 0 "$SCREEN" -nolisten tcp &
XVFB_PID=$!

for _ in $(seq 1 100)
do
    [ -S "/tmp/.X11-unix/X${DISPLAY_NUM}" ] && break
    sleep 0.1
done

if [ ! -S "/tmp/.X11-unix/X${DISPLAY_NUM}" ]
then
    echo "Xvfb 启动失败：没有出现 /tmp/.X11-unix/X${DISPLAY_NUM}" >&2
    exit 1
fi

# -viewonly：只允许看画面，不接受远程输入
x11vnc -display "$DISPLAY" -viewonly -localhost -nopw -rfbport "$RFB_PORT" -forever -shared -quiet -norc &
X11VNC_PID=$!

# noVNC 静态页 + WebSocket → VNC 转发；只监听回环，由 nginx 8080 对外
websockify --web=/usr/share/novnc "127.0.0.1:${WEB_PORT}" "127.0.0.1:${RFB_PORT}" &
WEBSOCKIFY_PID=$!

echo "live view: display=$DISPLAY screen=$SCREEN vnc=127.0.0.1:$RFB_PORT novnc=127.0.0.1:$WEB_PORT"

# 任一子进程退出就结束本进程，交给 supervisor 整体重启
wait -n

echo "live view 子进程退出，等待 supervisor 重启" >&2
exit 1
