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
 */
@CapacitorPlugin(name = "AppShell")
public class AppShellPlugin extends Plugin {

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
