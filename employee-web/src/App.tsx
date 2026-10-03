import { Route, Routes } from "react-router";

import { NotFound, RequireAuth } from "@/components/AppShell";
import { CallDetailScreen } from "@/screens/CallDetailScreen";
import { CallbacksScreen } from "@/screens/CallbacksScreen";
import { ChangePasswordScreen } from "@/screens/ChangePasswordScreen";
import { ContactDetailScreen } from "@/screens/ContactDetailScreen";
import { DialerScreen } from "@/screens/DialerScreen";
import { HistoryScreen } from "@/screens/HistoryScreen";
import { HomeScreen } from "@/screens/HomeScreen";
import { InCallScreen } from "@/screens/InCallScreen";
import { LoginScreen } from "@/screens/LoginScreen";
import { NotificationsScreen } from "@/screens/NotificationsScreen";
import { OutcomeScreen } from "@/screens/OutcomeScreen";
import { ProfileScreen } from "@/screens/ProfileScreen";
import { QueueScreen } from "@/screens/QueueScreen";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route element={<RequireAuth />}>
        <Route index element={<HomeScreen />} />
        <Route path="queue" element={<QueueScreen />} />
        <Route path="dial" element={<DialerScreen />} />
        <Route path="history" element={<HistoryScreen />} />
        <Route path="profile" element={<ProfileScreen />} />
        <Route path="contact/:id" element={<ContactDetailScreen />} />
        <Route path="call/:id" element={<CallDetailScreen />} />
        <Route path="outcome/:id" element={<OutcomeScreen />} />
        <Route path="incall/:id" element={<InCallScreen />} />
        <Route path="callbacks" element={<CallbacksScreen />} />
        <Route path="notifications" element={<NotificationsScreen />} />
        <Route path="change-password" element={<ChangePasswordScreen />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
