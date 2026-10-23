package com.asofianidis.passwordmanager.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Password
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import com.asofianidis.passwordmanager.vault.EntryType
import com.asofianidis.passwordmanager.vault.VaultStatus

/** A screen in the app's back stack. */
data class Route(val kind: String, val id: String? = null) {
    companion object {
        const val VAULT = "vault"
        const val GENERATOR = "generator"
        const val SETTINGS = "settings"
        const val ENTRY = "entry"
        const val EDIT = "edit"

        /** A new entry; `id` is the EntryType name */
        const val NEW = "new"
    }
}

class Navigator(private val stack: SnapshotStateList<Route>) {
    val current: Route get() = stack.last()
    val canGoBack: Boolean get() = stack.size > 1
    fun push(route: Route) = stack.add(route)
    fun back() {
        if (canGoBack) stack.removeAt(stack.lastIndex)
    }

    /** Replaces the top screen, e.g. the editor with the entry it saved. */
    fun replace(route: Route) {
        stack[stack.lastIndex] = route
    }

    fun tab(kind: String) {
        stack.clear()
        stack.add(Route(kind))
    }
}

val LocalNavigator = staticCompositionLocalOf<Navigator> { error("No navigator") }
val LocalSnackbar = staticCompositionLocalOf<SnackbarHostState> { error("No snackbar host") }

private val routeListSaver = listSaver<SnapshotStateList<Route>, String>(
    save = { list -> list.map { "${it.kind}|${it.id ?: ""}" } },
    restore = { saved ->
        mutableStateListOf(*saved.map { s -> s.split('|', limit = 2).let { Route(it[0], it[1].ifEmpty { null }) } }.toTypedArray())
    },
)

@Composable
fun HomeScreen(status: VaultStatus) {
    val stack = rememberSaveable(saver = routeListSaver) { mutableStateListOf(Route(Route.VAULT)) }
    val navigator = remember(stack) { Navigator(stack) }
    val snackbar = remember { SnackbarHostState() }
    BackHandler(enabled = navigator.canGoBack) { navigator.back() }
    val route = navigator.current
    val isTab = route.kind in setOf(Route.VAULT, Route.GENERATOR, Route.SETTINGS)

    CompositionLocalProvider(LocalNavigator provides navigator, LocalSnackbar provides snackbar) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                if (isTab) {
                    NavigationBar(containerColor = Palette.panel) {
                        listOf(
                            Triple(Route.VAULT, "Vault", Icons.Default.Key),
                            Triple(Route.GENERATOR, "Generator", Icons.Default.Password),
                            Triple(Route.SETTINGS, "Settings", Icons.Default.Settings),
                        ).forEach { (kind, label, icon) ->
                            NavigationBarItem(
                                selected = route.kind == kind,
                                onClick = { navigator.tab(kind) },
                                icon = { Icon(icon, contentDescription = null) },
                                label = { Text(label) },
                                colors = NavigationBarItemDefaults.colors(indicatorColor = Palette.sel, selectedIconColor = Palette.accent),
                            )
                        }
                    }
                }
            },
        ) { padding ->
            Box(Modifier.padding(bottom = if (isTab) padding.calculateBottomPadding() else androidx.compose.ui.unit.Dp(0f))) {
                when (route.kind) {
                    Route.VAULT -> VaultListScreen(status)
                    Route.GENERATOR -> GeneratorScreen()
                    Route.SETTINGS -> SettingsScreen()
                    Route.ENTRY -> EntryScreen(route.id!!, status)
                    Route.EDIT -> EditScreen(route.id)
                    Route.NEW -> EditScreen(null, route.id?.let { runCatching { EntryType.valueOf(it) }.getOrNull() } ?: EntryType.LOGIN)
                }
            }
        }
    }
}
