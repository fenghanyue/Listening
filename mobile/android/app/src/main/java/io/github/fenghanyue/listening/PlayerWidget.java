package io.github.fenghanyue.listening;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.widget.RemoteViews;
import java.util.Locale;

/**
 * 桌面 2×2 挂件（布局 res/layout/widget_player.xml）：顶上一行歌手 — 专辑，下面一道粗黑线，歌名大字，
 * 最下面一排播放模式、上一首、下一首、播放。
 *
 * 挂件自己不放歌，歌是在 App 的页面里放的，所以按键分两种情况：
 * - App 开着（AppShellPlugin 在）：按键发广播给 PlayerWidgetCommands，转给页面执行（AppShellPlugin.deliverWidgetCommand），不打开 App；
 * - App 没开（没打开过、被划掉了）：按键直接打开 App，页面起来以后再执行这个键（AppShellPlugin.handleOnNewIntent）。
 *   打开 / 关掉 App 时 AppShellPlugin 会重画挂件，把按键在两种之间换过来。
 * 显示的内容由页面通过 AppShell.updateWidget 报过来，存在 SharedPreferences 里：桌面要重画（开机、换桌面、
 * 新放一个挂件）时照着画；App 没开时显示最后放的那首、暂停着。
 * 挂件上的字（没在放歌时的那两行、按键的读屏名字）跟着 App 里选的语言，不跟手机系统的语言，见 localized。
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

    /** 页面报来的最新状态：存下来，重画所有挂件。lang 是 App 里选的界面语言（"zh" / "en"） */
    static void saveState(Context context, boolean hasTrack, String title, String artist, String album, boolean playing, int mode, String lang) {
        prefs(context)
            .edit()
            .putBoolean("hasTrack", hasTrack)
            .putString("title", title)
            .putString("artist", artist)
            .putString("album", album)
            .putBoolean("playing", playing)
            .putInt("mode", mode)
            .putString("lang", lang)
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
        // 字都从这里取：布局里写的 @string 是桌面按手机系统的语言解析的，App 里选了另一种语言就对不上，所以每个都在这里重设一遍
        Context text = localized(context, p.getString("lang", ""));

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_player);
        views.setTextViewText(R.id.widget_title, hasTrack ? title : text.getString(R.string.widget_idle_title));
        views.setTextViewText(R.id.widget_artist, hasTrack ? head : text.getString(R.string.widget_idle_artist));
        views.setImageViewResource(R.id.widget_mode, MODE_ICONS[mode]);
        views.setContentDescription(R.id.widget_mode, text.getString(MODE_NAMES[mode]));
        views.setContentDescription(R.id.widget_prev, text.getString(R.string.widget_prev));
        views.setContentDescription(R.id.widget_next, text.getString(R.string.widget_next));
        views.setImageViewResource(R.id.widget_play, playing ? R.drawable.ic_widget_pause : R.drawable.ic_widget_play);
        views.setContentDescription(R.id.widget_play, text.getString(playing ? R.string.widget_pause : R.string.widget_play));

        // 点歌名那一大块：打开 App
        views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getActivity(context, 0, openAppIntent(context, null), FLAGS));
        for (int i = 0; i < COMMANDS.length; i++) {
            PendingIntent pending;
            if (alive) {
                Intent intent = new Intent(context, PlayerWidgetCommands.class).setAction(ACTION_COMMAND).putExtra(EXTRA_COMMAND, COMMANDS[i]);
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

    /**
     * 按 App 里选的语言取字的 Context："en" 用 values-en 的英文，"zh" 用默认的中文。
     * 页面还没报过语言（装好以后还没打开过 App）时就按手机系统的语言，跟挂件列表里的预览一致
     */
    private static Context localized(Context context, String lang) {
        Locale locale = "en".equals(lang) ? Locale.ENGLISH : ("zh".equals(lang) ? Locale.SIMPLIFIED_CHINESE : null);
        if (locale == null) return context;
        Configuration conf = new Configuration(context.getResources().getConfiguration());
        conf.setLocale(locale);
        return context.createConfigurationContext(conf);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
