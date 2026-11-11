import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LocalVerificationControl } from '../lib/identity/local-verification';
import { localVerificationCopy } from '../i18n-identity';
type Props = { control: LocalVerificationControl; ready: boolean; allowed: boolean;
  setAllowed: (value: boolean) => Promise<void>; logout?: () => Promise<unknown>; locale: string };
const presentations = new WeakMap<LocalVerificationControl, Props>();
export function LocalVerificationControls(props: Props) {
  const {control,ready,allowed,setAllowed,logout,locale}=props,copy=localVerificationCopy(locale);
  presentations.set(control,props);
  const current=()=>control.isCurrent()&&presentations.get(control)===props;
  const create=()=>current()?control.createSession():Promise.resolve(false);
  const permit=()=>{if(current()&&ready)void setAllowed(!allowed);};
  const exit=()=>{if(current()&&ready)void logout?.();};
  return <View testID="local-verification-panel" style={{padding:12,borderRadius:16,backgroundColor:'#1B2824',gap:8}}>
    <Text testID="local-verification-title" style={{color:'#FFF5E2',fontWeight:'700'}}>{copy.title.normalize('NFC')}</Text><Text style={{color:'#EFE5CE'}}>{copy.body.normalize('NFC')}</Text>
    {!['vi','en'].includes(locale)?<Text testID="local-verification-language" style={{color:'#EFE5CE'}}>{copy.unsupported.normalize('NFC')}</Text>:null}
    {!ready?<Pressable testID="local-verification-create" accessibilityRole="button" onPress={create}>
      <Text style={{color:'#EFE5CE'}}>{copy.create.normalize('NFC')}</Text></Pressable>:<>
      <Pressable testID="local-verification-permission" accessibilityRole="button" onPress={permit}>
        <Text style={{color:'#EFE5CE'}}>{(allowed?copy.revoke:copy.allow).normalize('NFC')}</Text></Pressable>
      <Pressable testID="local-verification-logout" accessibilityRole="button" onPress={exit}>
        <Text style={{color:'#EFE5CE'}}>{copy.logout.normalize('NFC')}</Text></Pressable>
    </>}
  </View>;
}
