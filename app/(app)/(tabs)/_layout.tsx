import { Tabs } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fonts, fontSize, } from '../../../lib/theme';
import { StreakProvider, useStreak } from '../../../hooks/use-streak';
import { BookOpenIcon, HouseIcon, MicrophoneIcon, SettingsIcon, UserCircleIcon  } from '@/components/icons';
import * as Haptics from 'expo-haptics';
import { enterFlow } from '@/lib/navigation';
import { StreakBadge } from '@/components/StreakBadge';


export default function TabsLayout() {

  return (
    <StreakProvider>
      <TabsNavigator />
    </StreakProvider>
  );
}

function TabsNavigator() {

  const { count: streak } = useStreak()

  const openStreaks = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow('/streaks');
  };

  const openSettings = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    enterFlow('/settings');
  };

  return (
    <LinearGradient
      colors={[colors.surfaceElevated, colors.bg]}
      start={{ x: 0.5, y: 0 }}
      end={{ x: 0.5, y: 1 }}
      style={{ flex: 1}}
    >
    <Tabs
      screenOptions={{
        headerShown: true,
        headerTitleAlign: 'center',
        headerStyle: {
          backgroundColor: colors.surfaceElevated
        },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        headerTitleStyle: {
          fontFamily: fonts.regular,
          fontSize: fontSize.xxl,
        },
        sceneStyle: {
          backgroundColor: 'transparent'
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surfaceElevated,
          borderTopColor: colors.border,
        },

        headerLeft: () => (
          <StreakBadge count={streak} onPress={openStreaks}/>
        ),
        headerRight: () => (
          <SettingsButton onPress={openSettings}/>
        ),
        headerLeftContainerStyle: {
          paddingLeft: spacing.xl,
        },
        headerRightContainerStyle: {
          paddingRight: spacing.xl
        }
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
            tabBarIcon: ({ color }) => <HouseIcon color={color} />,
        }}
        />
      <Tabs.Screen
         name="practice"
          options={{
          title: 'Practice',
            tabBarIcon: ({ color }) => <MicrophoneIcon color={color} />,
          }}
          />
      <Tabs.Screen
        name="vocab"
        options={{
          title: 'Vocabulary',
          tabBarIcon: ({ color }) => <BookOpenIcon color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <UserCircleIcon color={color} />,

        }}
      />
    </Tabs>
    </LinearGradient>
  )
}

function SettingsButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.settingsContainer, pressed && styles.pressed]}
      >
        <SettingsIcon color={colors.text}/>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scene: { backgroundColor: 'transparent' },
  settingsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
    pressed: { opacity: 0.6 },
});
