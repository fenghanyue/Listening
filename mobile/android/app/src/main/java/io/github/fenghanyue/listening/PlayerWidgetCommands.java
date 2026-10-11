package io.github.fenghanyue.listening;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 桌面挂件上的键（App 开着时）发到这里。和 PlayerWidget 分开放：PlayerWidget 为了让各家桌面的挂件列表都能找到，
 * 在清单里对外公开（exported），这里不公开，别的 App 就没法冒充挂件替用户按播放。
 */
public class PlayerWidgetCommands extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!PlayerWidget.ACTION_COMMAND.equals(intent.getAction())) return;
        String command = intent.getStringExtra(PlayerWidget.EXTRA_COMMAND);
        if (command == null) return;
        if (AppShellPlugin.deliverWidgetCommand(command)) return;
        // 挂件上还是 App 开着时的按键，App 却已经不在了（被系统杀掉，没来得及重画）：先把按键改成"打开 App"，
        // 再试着打开。有的系统不让从后台直接打开界面，那就是这一下没反应，再按一次就能打开
        PlayerWidget.renderAll(context);
        try {
            context.startActivity(PlayerWidget.openAppIntent(context, command).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException ignored) {
            // 打不开就算了，按键已经改好了
        }
    }
}
