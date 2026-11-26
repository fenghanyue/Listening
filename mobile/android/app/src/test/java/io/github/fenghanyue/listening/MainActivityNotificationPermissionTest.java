package io.github.fenghanyue.listening;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.Build;
import org.junit.Test;

public class MainActivityNotificationPermissionTest {

    @Test
    public void skipsBelowAndroid13() {
        assertFalse(MainActivity.shouldRequestNotificationPermission(Build.VERSION_CODES.S_V2, false, false));
    }

    @Test
    public void requestsOnceOnAndroid13PlusWhenNotGranted() {
        assertTrue(MainActivity.shouldRequestNotificationPermission(Build.VERSION_CODES.TIRAMISU, false, false));
        assertTrue(MainActivity.shouldRequestNotificationPermission(36, false, false));
    }

    @Test
    public void skipsWhenAlreadyGrantedOrPrompted() {
        assertFalse(MainActivity.shouldRequestNotificationPermission(Build.VERSION_CODES.TIRAMISU, true, false));
        assertFalse(MainActivity.shouldRequestNotificationPermission(Build.VERSION_CODES.TIRAMISU, false, true));
        assertFalse(MainActivity.shouldRequestNotificationPermission(36, true, true));
    }
}
