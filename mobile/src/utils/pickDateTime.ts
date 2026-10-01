import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

/** Native Android date dialog followed by the time dialog. Resolves to epoch ms, or null if the user cancelled. */
export function pickDateTime(initialMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const start = new Date(Math.max(initialMs, Date.now()));
    DateTimePickerAndroid.open({
      value: start,
      mode: 'date',
      minimumDate: new Date(new Date().setHours(0, 0, 0, 0)),
      onValueChange: (_event, date) => {
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          is24Hour: false,
          onValueChange: (_timeEvent, time) => {
            const chosen = new Date(date);
            chosen.setHours(time.getHours(), time.getMinutes(), 0, 0);
            resolve(chosen.getTime());
          },
          onDismiss: () => resolve(null),
        });
      },
      onDismiss: () => resolve(null),
    });
  });
}
