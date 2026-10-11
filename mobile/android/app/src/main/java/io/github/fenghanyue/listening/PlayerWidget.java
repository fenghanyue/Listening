package io.github.fenghanyue.listening;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * 桌面 2×2 挂件（布局 res/layout/widget_player.xml）：顶上一行歌手 — 专辑，下面一道粗黑线，歌名大字，
 * 最下面一排播放模式、上一首、下一首、播放。
 *
 * 挂件自己不放歌，歌是在 App 的页面里放的，所以按键分两种情况：
 * - App 开着（AppShellPlugin 在）：按键发广播到这里，转给页面执行（AppShellPlugin.deliverWidgetCommand），不打开 App；
 * - App 没开（没打开过、被划掉了）：按键直接打开 App，页面起来以后再执行这个键（AppShellPlugin.handleOnNewIntent）。
 *   打开 / 关掉 App 时 AppShellPlugin 会重画挂件，把按键在两种之间换过来。
 * 显示的内容由页面通过 AppShell.updateWidget 报过来，存在 SharedPreferences 里：桌面要重画（开机、换桌面、
 * 新放一个挂件）时照着画；App 没开时显示最后放的那首、暂停着。
 */
public class PlayerWidget extends AppWidgetProvider {

    static final String ACTION_COMMAND = "io.github.fenghanyue.listening.WIDGET_COMMAND";
    static final String EXTRA_COMMAND = "command";

    private static final String PREFS = "player_widget";
    private static final int FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

    // 四个键：发给页面的命令（页面里 handleWidgetCommand 认的名字）和对应的控件，下标 + 1 当 PendingIntent 的 requestCode，
    // 每个键一个，免得互相覆盖
    private static final String[] COMMANDS = { "mode", "prev", "next", "toggle" };
    private static final int[] BUTTONS = { R.id.widget_mode, R.id.widget_prev, R.id.widget_next, R.id.widget_play };

    // 播放模式（页面的 playMode：0 列表循环 / 1 随机播放 / 2 单曲循环）的图标和读屏名字
    private static final int[] MODE_ICONS = { R.drawable.ic_widget_repeat, R.drawable.ic_widget_shuffle, R.drawable.ic_widget_repeat_one };
    private static final int[] MODE_NAMES = { R.string.widget_mode_list, R.string.widget_mode_shuffle, R.string.widget_mode_one };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
        render(context, manager, appWidgetIds);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_COMMAND.equals(intent.getAction())) return;
        String command = intent.getStringExtra(EXTRA_COMMAND);
        if (command == null) return;
        if (AppShellPlugin.deliverWidgetCommand(command)) return;
        // 挂件上还是 App 开着时的按键，App 却已经不在了（被系统杀掉，没来得及重画）：先把按键改成"打开 App"，
        // 再试着打开。有的系统不让从后台直接打开界面，那就是这一下没反应，再按一次就能打开
        renderAll(context);
        try {
            context.startActivity(openAppIntent(context, command).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (RuntimeException ignored) {
            // 打不开就算了，按键已经改好了
        }
    }

    /** 页面报来的最新状态：存下来，重画所有挂件 */
    static void saveState(Context context, boolean hasTrack, String title, String artist, String album, boolean playing, int mode) {
        prefs(context)
            .edit()
            .putBoolean("hasTrack", hasTrack)
            .putString("title", title)
            .putString("artist", artist)
            .putString("album", album)
            .putBoolean("playing", playing)
            .putInt("mode", mode)
            .apply();
        renderAll(context);
    }

    static void renderAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) return;
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PlayerWidget.class));
        if (ids != null && ids.length > 0) render(context, manager, ids);
    }

    private static void render(Context context, AppWidgetManager manager, int[] ids) {
        SharedPreferences p = prefs(context);
        boolean alive = AppShellPlugin.isActive();
        boolean hasTrack = p.getBoolean("hasTrack", false);
        String title = p.getString("title", "");
        String artist = p.getString("artist", "");
        String album = p.getString("album", "");
        String head = album.isEmpty() ? artist : (artist.isEmpty() ? album : artist + " — " + album);
        int mode = p.getInt("mode", 0);
        if (mode < 0 || mode >= MODE_ICONS.length) mode = 0;
        // App 没开就没有在放的歌，一律显示播放键
        boolean playing = alive && p.getBoolean("playing", false);

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_player);
        views.setTextViewText(R.id.widget_title, hasTrack ? title : context.getString(R.string.widget_idle_title));
        views.setTextViewText(R.id.widget_artist, hasTrack ? head : context.getString(R.string.widget_idle_artist));
        views.setImageViewResource(R.id.widget_mode, MODE_ICONS[mode]);
        views.setContentDescription(R.id.widget_mode, context.getString(MODE_NAMES[mode]));
        views.setImageViewResource(R.id.widget_play, playing ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play);
        views.setContentDescription(R.id.widget_play, context.getString(playing ? R.string.widget_pause : R.string.widget_play));

        // 点歌名那一大块：打开 App
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, openAppIntent(context, null), FLAGS));
        for (int i = 0; i < COMMANDS.length; i++) {
            PendingIntent pending;
            if (alive) {
                Intent intent = new Intent(context, PlayerWidget.class).setAction(ACTION_COMMAND).putExtra(EXTRA_COMMAND, COMMANDS[i]);
                pending = PendingIntent.getBroadcast(context, i + 1, intent, FLAGS);
            } else {
                pending = PendingIntent.getActivity(context, i + 1, openAppIntent(context, COMMANDS[i]), FLAGS);
            }
            views.setOnClickPendingIntent(BUTTONS[i], pending);
        }
        manager.updateAppWidget(ids, views);
    }

    /** 打开 App 的 Intent；command 不为空时，页面起来以后执行这个键 */
    static Intent openAppIntent(Context context, String command) {
        Intent intent = new Intent(context, MainActivity.class);
        if (command != null) intent.setAction(ACTION_COMMAND).putExtra(EXTRA_COMMAND, command);
        return intent;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
