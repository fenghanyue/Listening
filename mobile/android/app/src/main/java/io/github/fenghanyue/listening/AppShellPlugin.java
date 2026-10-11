package io.github.fenghanyue.listening;

import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 页面用到的几件原生小事，现成插件里没有的都放这里：
 * - 拔耳机 / 蓝牙耳机断开时通知页面暂停（系统广播 ACTION_AUDIO_BECOMING_NOISY）
 * - 查询、打开"允许在后台运行"（电池优化）设置：国产系统锁屏后最爱杀后台
 * - 用系统浏览器打开链接（下载新版 APK）
 * - 桌面挂件（PlayerWidget）：页面报来要显示的东西，挂件上的键转给页面（事件 widgetCommand）
 */
@CapacitorPlugin(name = "AppShell")
public class AppShellPlugin extends Plugin {

    // 当前这个 App 界面里的插件实例：挂件靠它判断 App 开没开、把按键转给页面。每次打开 App 新建一个，关掉时清空
    private static volatile AppShellPlugin active;

    private BroadcastReceiver noisyReceiver;

    @Override
    public void load() {
        noisyReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                    notifyListeners("audioBecomingNoisy", new JSObject());
                }
            }
        };
        // 系统广播，不需要别的 App 发进来，NOT_EXPORTED 就够（Android 14 起动态注册必须二选一）
        ContextCompat.registerReceiver(
            getContext(),
            noisyReceiver,
            new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        active = this;
        // 挂件上的键从"打开 App"换成直接控制
        PlayerWidget.renderAll(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        if (noisyReceiver != null) {
            try {
                getContext().unregisterReceiver(noisyReceiver);
            } catch (IllegalArgumentException ignored) {
                // 已经注销过
            }
            noisyReceiver = null;
        }
        if (active == this) {
            active = null;
            // App 关了：挂件改回"按了打开 App"，播放键显示成播放
            PlayerWidget.renderAll(getContext());
        }
    }

    static boolean isActive() {
        return active != null;
    }

    /** 挂件上的键：App 开着就交给页面，返回 true；App 没开返回 false */
    static boolean deliverWidgetCommand(String command) {
        AppShellPlugin plugin = active;
        if (plugin == null) return false;
        plugin.sendWidgetCommand(command);
        return true;
    }

    // 页面还没开始听（刚打开 App、页面还在加载）也不丢：先存着，页面一开始听就给它
    private void sendWidgetCommand(String command) {
        JSObject data = new JSObject();
        data.put("command", command);
        notifyListeners("widgetCommand", data, true);
    }

    /**
     * App 没开时按挂件上的键，打开 App 用的 Intent 里带着这个键，页面起来以后执行。Capacitor 在 App 启动
     * （和开着时又被打开）时会把 Intent 交到这里。从最近任务里重新打开时系统会重放当初那个 Intent，不能再执行一遍
     */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (intent == null || !PlayerWidget.ACTION_COMMAND.equals(intent.getAction())) return;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return;
        String command = intent.getStringExtra(PlayerWidget.EXTRA_COMMAND);
        intent.removeExtra(PlayerWidget.EXTRA_COMMAND);
        if (command != null) sendWidgetCommand(command);
    }

    /** 页面报来挂件要显示的东西：{ hasTrack, title, artist, album, playing, mode, lang }（lang 是 App 里选的语言 "zh" / "en"） */
    @PluginMethod
    public void updateWidget(PluginCall call) {
        PlayerWidget.saveState(
            getContext(),
            Boolean.TRUE.equals(call.getBoolean("hasTrack", false)),
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            Boolean.TRUE.equals(call.getBoolean("playing", false)),
            call.getInt("mode", 0),
            call.getString("lang", "")
        );
        call.resolve();
    }

    /** { ignoring: boolean }：是否已经放行"不受电池优化限制"（Android 6 以下没有这个限制，按已放行算） */
    @PluginMethod
    public void getBatteryOptimization(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoringBatteryOptimizations());
        call.resolve(ret);
    }

    /**
     * 打开电池相关设置。target 为 "auto"（默认）时：还没放行就弹系统的"允许在后台运行"对话框，一步到位；
     * 已经放行了就打开应用详情页——小米的"省电策略"、华为的"应用启动管理"这类厂商开关都在那儿。
     * 有的系统把某个入口拦了，就按顺序试下一个。
     */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        String pkg = getContext().getPackageName();
        String target = call.getString("target", "auto");
        boolean wantDialog = "dialog".equals(target) || ("auto".equals(target) && !isIgnoringBatteryOptimizations());

        Intent dialog = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
        Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        Intent list = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        Intent[] candidates = wantDialog ? new Intent[] { dialog, details, list } : new Intent[] { details, list };

        for (Intent intent : candidates) {
            try {
                getActivity().startActivity(intent);
                call.resolve();
                return;
            } catch (ActivityNotFoundException | SecurityException e) {
                // 这个入口被系统拦了，试下一个
            }
        }
        call.reject("打不开系统设置");
    }

    /** 用系统浏览器打开 http(s) 链接 */
    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) {
            call.reject("只支持 http(s) 链接");
            return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("没有能打开链接的应用");
        }
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
